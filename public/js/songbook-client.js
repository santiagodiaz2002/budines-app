import { getStorage, scopedStorageKey } from './local-storage.js?v=auth-20260723';

const SONG_KEYS = ['budines.metronome.songs.v2', 'budines.metronome.songs.v1'];
const LEGACY_CLAIM_KEY = 'budines.local.legacy-owner-claim.v1';
const EPOCH = new Date(0).toISOString();

export class SongbookClientError extends Error {
  constructor(message, { status = 0, code = 'network_error', payload = null } = {}) {
    super(message);
    this.name = 'SongbookClientError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

// Shared songs are never cached locally. The original device libraries are only read
// for migration and are retained even when an import fails or a song is later deleted.
export function createSongbookClient({ fetchImpl = globalThis.fetch, storage, timeoutMs = 8000 } = {}) {
  async function request(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const options = {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    try {
      const response = await fetchImpl('/api/songbook', options);
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new SongbookClientError('La respuesta del cancionero no fue válida. Reintentá.', {
          status: response.status, code: 'invalid_response'
        });
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new SongbookClientError('La respuesta del cancionero no fue válida. Reintentá.', { status: response.status, code: 'invalid_response' });
      }
      if (!response.ok || payload?.ok === false) {
        throw new SongbookClientError(payload?.error?.message || 'No se pudo completar la operación del cancionero.', {
          status: response.status, code: payload?.error?.code || 'api_error', payload
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof SongbookClientError) throw error;
      throw new SongbookClientError('No hay conexión con el cancionero o el servidor no respondió. No se pudo confirmar la operación; reintentá.');
    } finally {
      clearTimeout(timer);
    }
  }

  async function importLegacy() {
    const report = { imported: 0, skipped: 0, invalid: 0, mappings: Object.create(null), mappingEntries: [] };
    let localStorage;
    try { localStorage = storage === undefined ? getStorage() : storage; }
    catch { throw new SongbookClientError('No se pudieron leer las canciones de este dispositivo. Los originales se conservaron.', { code: 'local_storage_error' }); }
    const sources = readLegacySources(localStorage, report);
    const seen = new Map();
    for (const { sourceKey, originKey, schemaVersion, songs } of sources) {
      for (const [index, rawSong] of songs.entries()) {
        const song = await normalizeLegacySong(rawSong, { sourceKey: originKey, schemaVersion, index });
        if (!song) {
          report.invalid += 1;
          continue;
        }
        const fingerprint = JSON.stringify({ id: song.id, createdAt: song.createdAt, name: song.name, blocks: song.blocks });
        let result = seen.get(fingerprint);
        if (result) {
          report.skipped += 1;
        } else {
          try {
            result = await request({ action: 'importSong', song });
          } catch (error) {
            // Keep evidence of completed imports when a later request fails. Repeating
            // the whole migration is safe because the server owns the import ledger.
            error.report = report;
            throw error;
          }
          seen.set(fingerprint, result);
          if (result.imported && !result.skipped && !result.deleted) report.imported += 1;
          else report.skipped += 1;
        }
        const globalId = result.song?.id || result.importedId || null;
        const legacyId = typeof rawSong?.id === 'string' && rawSong.id ? rawSong.id : song.id;
        report.mappingEntries.push({ sourceKey, index, legacyId, id: globalId, deleted: Boolean(result.deleted) });
        if (!result.deleted && globalId && !Object.hasOwn(report.mappings, legacyId)) {
          report.mappings[legacyId] = globalId;
        }
      }
    }
    return report;
  }

  return { list: () => request(), mutate: request, importLegacy };
}

function readLegacySources(storage, report) {
  if (!storage) return [];
  try {
    const keys = new Set([...SONG_KEYS.map((key) => scopedStorageKey(key)), ...SONG_KEYS]);
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === 'string' && /^budines\.metronome\.songs\.v[12](?:\.user\.[A-Za-z0-9._-]+)?$/.test(key)) keys.add(key);
    }
    const claim = storage.getItem(LEGACY_CLAIM_KEY);
    const sources = [];
    for (const sourceKey of keys) {
      const value = storage.getItem(sourceKey);
      if (value === null) continue;
      let parsed;
      try { parsed = JSON.parse(value); } catch { report.invalid += 1; continue; }
      if (!Array.isArray(parsed?.songs)) { report.invalid += 1; continue; }
      const baseKey = SONG_KEYS.find((key) => sourceKey === key || sourceKey.startsWith(`${key}.user.`));
      // The old owner migration copied a base key verbatim. Such a copy is the
      // same origin even when a malformed old song had no id of its own.
      const originKey = claim && sourceKey === `${baseKey}.user.${claim}` && storage.getItem(baseKey) === value ? baseKey : sourceKey;
      sources.push({ sourceKey, originKey, schemaVersion: parsed.schemaVersion || (baseKey.endsWith('v1') ? 1 : 2), songs: parsed.songs });
    }
    return sources;
  } catch {
    throw new SongbookClientError('No se pudieron leer las canciones de este dispositivo. Los originales se conservaron.', { code: 'local_storage_error' });
  }
}

async function normalizeLegacySong(rawSong, { sourceKey, schemaVersion, index }) {
  if (!rawSong || typeof rawSong !== 'object' || ![1, 2].includes(rawSong.schemaVersion ?? schemaVersion)) return null;
  const name = validName(rawSong.name, 80);
  if (!name || !Array.isArray(rawSong.blocks) || rawSong.blocks.length < 1 || rawSong.blocks.length > 32) return null;
  const createdAt = validTimestamp(rawSong.createdAt, EPOCH);
  const updatedAt = validTimestamp(rawSong.updatedAt, createdAt);
  if (!createdAt || !updatedAt) return null;
  const blocks = [];
  for (const [blockIndex, rawBlock] of rawSong.blocks.entries()) {
    if (!rawBlock || typeof rawBlock !== 'object') return null;
    const partName = validName(rawBlock.name ?? `Parte ${blockIndex + 1}`, 40);
    const measures = validInteger(rawBlock.measures, 1, 999);
    const bpm = validInteger(rawBlock.bpm, 30, 300);
    if (!partName || measures === null || bpm === null) return null;
    const id = typeof rawBlock.id === 'string' && rawBlock.id.trim() ? rawBlock.id : `part-${blockIndex + 1}`;
    if (id.length > 200) return null;
    const block = { id, name: partName, measures, bpm, order: blockIndex };
    if (rawBlock.ramp !== undefined) {
      const ramp = rawBlock.ramp;
      const targetBpm = validInteger(ramp?.targetBpm, 30, 300);
      const rampMeasures = validInteger(ramp?.measures, 1, measures);
      if (typeof ramp?.enabled !== 'boolean' || targetBpm === null || rampMeasures === null || (ramp.enabled && targetBpm <= bpm)) return null;
      block.ramp = { enabled: ramp.enabled, targetBpm, measures: rampMeasures };
    }
    blocks.push(block);
  }
  let id = typeof rawSong.id === 'string' && rawSong.id.trim() ? rawSong.id : null;
  if (!id) {
    // Source and position distinguish independent identical legacy songs without
    // ids. Hashing content also preserves later variants instead of overwriting.
    const bytes = new TextEncoder().encode(JSON.stringify({ sourceKey, index, createdAt, name, blocks }));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    id = `legacy-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  if (id.length > 200) return null;
  return { id, schemaVersion: 2, name, blocks, createdAt, updatedAt };
}

function validName(value, maxLength) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 && name.length <= maxLength ? name : null;
}

function validInteger(value, min, max) {
  if (typeof value === 'string' && !/^[0-9]+$/.test(value.trim())) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function validTimestamp(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime()) ? value : null;
}
