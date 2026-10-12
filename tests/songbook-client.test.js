import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSongbookClient, SongbookClientError } from '../public/js/songbook-client.js';
import { clearLocalStorageUser, setLocalStorageUser } from '../public/js/local-storage.js?v=auth-20260723';

const V1 = 'budines.metronome.songs.v1';
const V2 = 'budines.metronome.songs.v2';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { clearLocalStorageUser(); vi.unstubAllGlobals(); });

describe('cliente del cancionero compartido', () => {
  it('consulta y modifica con sesión del servidor y no-store', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true, songs: [], folders: [] }));
    const client = createSongbookClient({ fetchImpl, storage: null });
    await client.list();
    await client.mutate({ action: 'createFolder', id: 'folder-id', name: 'Banda' });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/songbook', expect.objectContaining({
      method: 'GET', credentials: 'same-origin', cache: 'no-store'
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/songbook', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      body: JSON.stringify({ action: 'createFolder', id: 'folder-id', name: 'Banda' })
    }));
  });

  it('muestra el error del servidor y nunca simula un guardado cuando no hay sesión', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: false, error: { code: 'authentication_required', message: 'Iniciá sesión.' } }, 401));
    const client = createSongbookClient({ fetchImpl, storage: null });
    await expect(client.mutate({ action: 'createSong' })).rejects.toMatchObject({
      status: 401, code: 'authentication_required', message: 'Iniciá sesión.'
    });
  });

  it('informa fallos de conexión, vencimiento y respuestas inválidas', async () => {
    const broken = createSongbookClient({ storage: null, fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) });
    await expect(broken.list()).rejects.toThrow('No hay conexión con el cancionero');
    const malformed = createSongbookClient({ storage: null, fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => { throw new Error('html'); } }) });
    await expect(malformed.list()).rejects.toMatchObject({ code: 'invalid_response' });
    const expired = createSongbookClient({ storage: null, timeoutMs: 1, fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }) });
    await expect(expired.list()).rejects.toBeInstanceOf(SongbookClientError);
  });

  it('lee v1, v2 y todos los usuarios; conserva mismo título y variantes de un mismo ID', async () => {
    const a = song('shared-id', 'Igual', 100);
    const b = song('second-id', 'Igual', 140);
    const variant = song('shared-id', 'Igual', 120);
    const storage = new MemoryStorage({
      [V1]: library([{ ...a, schemaVersion: 1 }], 1),
      [V2]: library([a]),
      [`${V2}.user.santi`]: library([b]),
      [`${V2}.user.leandro`]: library([variant]),
      'budines.truco.v1.user.santi': '{"score":12}'
    });
    const original = storage.snapshot();
    const server = makeImportServer();
    const report = await createSongbookClient({ storage, fetchImpl: server.fetch }).importLegacy();
    expect(report).toMatchObject({ imported: 3, skipped: 1, invalid: 0 });
    expect(server.songs.map((item) => item.blocks[0].bpm).sort()).toEqual([100, 120, 140]);
    expect(report.mappingEntries).toHaveLength(4);
    expect(report.mappings['shared-id']).toBeTruthy();
    expect(storage.snapshot()).toEqual(original);
    expect(storage.writes).toBe(0);
  });

  it('mantiene IDs faltantes estables y distingue canciones idénticas independientes', async () => {
    const noId = song(null, 'Sin ID', 100);
    delete noId.id;
    const storage = new MemoryStorage({
      [V1]: library([noId, noId], 1),
      [`${V1}.user.leandro`]: library([noId], 1)
    });
    const server = makeImportServer();
    const client = createSongbookClient({ storage, fetchImpl: server.fetch });
    const first = await client.importLegacy();
    const second = await client.importLegacy();
    expect(first.imported).toBe(3);
    expect(second).toMatchObject({ imported: 0, skipped: 3 });
    expect(new Set(first.mappingEntries.map((entry) => entry.legacyId)).size).toBe(3);
    expect(second.mappingEntries).toEqual(first.mappingEntries);
    expect(storage.writes).toBe(0);
  });

  it('reconoce la copia exacta creada por el marcador histórico del primer owner', async () => {
    const noId = song(null, 'Original', 100);
    delete noId.id;
    const value = library([noId], 1);
    const storage = new MemoryStorage({
      [V1]: value,
      [`${V1}.user.santi`]: value,
      'budines.local.legacy-owner-claim.v1': 'santi'
    });
    const server = makeImportServer();
    const report = await createSongbookClient({ storage, fetchImpl: server.fetch }).importLegacy();
    expect(report).toMatchObject({ imported: 1, skipped: 1 });
    expect(report.mappingEntries[0].id).toBe(report.mappingEntries[1].id);
    expect(storage.writes).toBe(0);
  });

  it('da preferencia al scope activo para el mapa de IDs sin descartar otras variantes', async () => {
    setLocalStorageUser({ id: 'santi', capabilities: { canAccessBudines: false } });
    const storage = new MemoryStorage({
      [V2]: library([song('same-id', 'Versión vieja', 100)]),
      [`${V2}.user.santi`]: library([song('same-id', 'Versión actual', 140)])
    });
    const server = makeImportServer();
    const report = await createSongbookClient({ storage, fetchImpl: server.fetch }).importLegacy();
    const selected = server.songs.find((item) => item.id === report.mappings['same-id']);
    expect(selected.name).toBe('Versión actual');
    expect(report.imported).toBe(2);
  });

  it('prefiere también v1 del usuario activo sobre una v2 base histórica', async () => {
    setLocalStorageUser({ id: 'santi', capabilities: { canAccessBudines: false } });
    const storage = new MemoryStorage({
      [V2]: library([song('same-id', 'Base histórica', 100)]),
      [`${V1}.user.santi`]: library([{ ...song('same-id', 'Activa v1', 140), schemaVersion: 1 }], 1)
    });
    const server = makeImportServer();
    const report = await createSongbookClient({ storage, fetchImpl: server.fetch }).importLegacy();
    expect(server.songs.find(item => item.id === report.mappings['same-id']).name).toBe('Activa v1');
    expect(report.imported).toBe(2);
  });

  it('informa canciones o bibliotecas inválidas sin reemplazar los originales', async () => {
    const storage = new MemoryStorage({
      [V1]: '{roto',
      [V2]: library([song('ok', 'Conservar', 100), song('bad', 'Inválida', 999), { ...song('future', 'Futura', 100), schemaVersion: 999 }]),
      [`${V2}.user.otro`]: '{"schemaVersion":2}'
    });
    const original = storage.snapshot();
    const server = makeImportServer();
    const report = await createSongbookClient({ storage, fetchImpl: server.fetch }).importLegacy();
    expect(report).toMatchObject({ imported: 1, invalid: 4 });
    expect(storage.snapshot()).toEqual(original);
    expect(storage.writes).toBe(0);
  });

  it('preserva parámetros musicales, nombres de partes y fechas de origen', async () => {
    const rampSong = song('ramp', 'Con aceleración', 100);
    rampSong.blocks[0].ramp = { enabled: true, targetBpm: 140, measures: 1 };
    const storage = new MemoryStorage({ [V2]: library([rampSong]) });
    const server = makeImportServer();
    await createSongbookClient({ storage, fetchImpl: server.fetch }).importLegacy();
    expect(server.songs[0]).toMatchObject({
      name: rampSong.name, blocks: rampSong.blocks,
      createdAt: rampSong.createdAt, updatedAt: rampSong.updatedAt
    });
  });

  it('aísla una aceleración inválida y continúa importando el resto sin alterar originales', async () => {
    const invalidRamp = song('bad-ramp', 'Aceleración inválida', 100);
    invalidRamp.blocks[0].ramp = { enabled: true, targetBpm: 90, measures: 1 };
    const storage = new MemoryStorage({ [V2]: library([invalidRamp, song('valid', 'Canción válida', 120)]) });
    const original = storage.snapshot();
    const server = makeImportServer();
    const report = await createSongbookClient({ storage, fetchImpl: server.fetch }).importLegacy();
    expect(report).toMatchObject({ imported: 1, invalid: 1 });
    expect(server.songs[0].name).toBe('Canción válida');
    expect(storage.snapshot()).toEqual(original);
  });

  it('repite una importación sin duplicar ni resucitar una canción eliminada', async () => {
    const storage = new MemoryStorage({ [V2]: library([song('local-id', 'Canción', 100)]) });
    const server = makeImportServer();
    const client = createSongbookClient({ storage, fetchImpl: server.fetch });
    const first = await client.importLegacy();
    expect(first.imported).toBe(1);
    expect((await client.importLegacy()).skipped).toBe(1);
    server.deleteAll();
    const deleted = await client.importLegacy();
    expect(deleted).toMatchObject({ imported: 0, skipped: 1, mappings: {} });
    expect(deleted.mappingEntries[0].deleted).toBe(true);
    expect(server.songs).toHaveLength(0);
    expect(storage.getItem(V2)).not.toBeNull();
  });

  it('conserva el reporte parcial y permite reintentar después de un fallo de red', async () => {
    const storage = new MemoryStorage({ [V2]: library([song('a', 'A', 100), song('b', 'B', 120)]) });
    const server = makeImportServer();
    let requestNumber = 0;
    const interruptedFetch = async (...args) => {
      requestNumber += 1;
      if (requestNumber === 2) throw new Error('connection lost');
      return server.fetch(...args);
    };
    await expect(createSongbookClient({ storage, fetchImpl: interruptedFetch }).importLegacy()).rejects.toMatchObject({ report: { imported: 1 } });
    const resumed = await createSongbookClient({ storage, fetchImpl: server.fetch }).importLegacy();
    expect(resumed).toMatchObject({ imported: 1, skipped: 1 });
    expect(server.songs).toHaveLength(2);
    expect(storage.writes).toBe(0);
  });

  it('no lee ni escribe cachés privadas cuando solo consulta o modifica el servidor', async () => {
    const storage = { getItem: vi.fn(() => { throw new Error('storage denied'); }), setItem: vi.fn() };
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true, songs: [], folders: [] }));
    const client = createSongbookClient({ storage, fetchImpl });
    await client.list();
    await client.mutate({ action: 'deleteSong', id: 'uuid', revision: 1 });
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    await expect(client.importLegacy()).rejects.toMatchObject({ code: 'local_storage_error' });
  });
});

function song(id, name, bpm) {
  return { id, name, schemaVersion: 2, createdAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-02-03T04:05:06.000Z',
    blocks: [{ id: 'part-id', name: 'Intro', measures: 4, bpm, order: 0 }] };
}

function library(songs, schemaVersion = 2) { return JSON.stringify({ schemaVersion, songs }); }
function response(payload, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }

class MemoryStorage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); this.writes = 0; }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.writes += 1; this.values.set(key, value); }
  snapshot() { return Object.fromEntries(this.values); }
}

function makeImportServer() {
  const ledger = new Map();
  const songs = [];
  return {
    songs,
    deleteAll() { songs.splice(0); for (const entry of ledger.values()) entry.deleted = true; },
    fetch: vi.fn(async (_url, options) => {
      const { song: legacy } = JSON.parse(options.body);
      const key = JSON.stringify({ id: legacy.id, createdAt: legacy.createdAt, name: legacy.name, blocks: legacy.blocks });
      const existing = ledger.get(key);
      if (existing) return response({ ok: true, song: existing.deleted ? null : existing.song, importedId: existing.song.id, imported: false, skipped: true, deleted: existing.deleted });
      const saved = { ...legacy, id: `global-${ledger.size + 1}`, folderId: null, revision: 1 };
      ledger.set(key, { song: saved, deleted: false });
      songs.push(saved);
      return response({ ok: true, song: saved, importedId: saved.id, imported: true, skipped: false, deleted: false });
    })
  };
}
