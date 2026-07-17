export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const MIN_MEASURES = 1;
export const MAX_MEASURES = 999;
export const BEATS_PER_MEASURE = 4;
export const INITIAL_COUNT_IN_BEATS = 4;
export const MAX_PARTS = 32;
export const SONG_SCHEMA_VERSION = 2;
export const PREVIOUS_SONG_SCHEMA_VERSION = 1;
export const MAX_PART_NAME_LENGTH = 40;
export const MAX_SONG_NAME_LENGTH = 80;

export const DEFAULT_BLOCKS = [
  { id: 'default-parte-1', name: 'Parte 1', measures: 4, bpm: 100, order: 0 }
];

const STRICT_INTEGER_PATTERN = /^[0-9]+$/;
const DEFAULT_ID_FACTORY = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function parseStrictInteger(raw, { min, max, label }) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, message: `${label} es obligatorio.` };
  }

  const valueText = raw.trim();
  if (!STRICT_INTEGER_PATTERN.test(valueText)) {
    return { ok: false, message: `${label} debe ser un entero entre ${min} y ${max}.` };
  }

  const value = Number(valueText);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return { ok: false, message: `${label} debe estar entre ${min} y ${max}.` };
  }

  return { ok: true, value };
}

export function parseBpm(raw) {
  return parseStrictInteger(raw, { min: MIN_BPM, max: MAX_BPM, label: 'BPM' });
}

export function parseMeasures(raw) {
  return parseStrictInteger(raw, { min: MIN_MEASURES, max: MAX_MEASURES, label: 'Compases' });
}

export function parsePartName(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Nombre de la parte es obligatorio.' };
  }

  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, message: 'Nombre de la parte es obligatorio.' };
  }
  if (value.length > MAX_PART_NAME_LENGTH) {
    return { ok: false, message: `Nombre de la parte debe tener hasta ${MAX_PART_NAME_LENGTH} caracteres.` };
  }

  return { ok: true, value };
}

export function parseSongName(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Nombre de la canción es obligatorio.' };
  }

  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, message: 'Nombre de la canción es obligatorio.' };
  }
  if (value.length > MAX_SONG_NAME_LENGTH) {
    return { ok: false, message: `Nombre de la canción debe tener hasta ${MAX_SONG_NAME_LENGTH} caracteres.` };
  }

  return { ok: true, value };
}

export function normalizeBlocks(value, { fallbackToDefault = true, rejectOverflow = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    return fallbackToDefault ? cloneDefaultBlocks() : [];
  }

  if (value.length > MAX_PARTS) {
    if (rejectOverflow) {
      return null;
    }
    return fallbackToDefault ? cloneDefaultBlocks() : [];
  }

  const blocks = [];
  for (let index = 0; index < value.length; index += 1) {
    const normalized = normalizePlaybackBlock(value[index], index);
    if (!normalized) {
      return fallbackToDefault ? cloneDefaultBlocks() : null;
    }
    blocks.push(normalized);
  }

  return blocks.map((block, index) => ({ ...block, order: index }));
}

export function validateEditableBlocks(rows, { idFactory = DEFAULT_ID_FACTORY } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, message: 'La canción debe tener al menos una parte.' };
  }
  if (rows.length > MAX_PARTS) {
    return { ok: false, message: `La canción puede tener hasta ${MAX_PARTS} partes.` };
  }

  const blocks = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const name = parsePartName(row.name);
    if (!name.ok) {
      return { ok: false, message: name.message, field: 'name', index };
    }

    const measures = parseMeasures(String(row.measures ?? ''));
    if (!measures.ok) {
      return { ok: false, message: measures.message, field: 'measures', index };
    }

    const bpm = parseBpm(String(row.bpm ?? ''));
    if (!bpm.ok) {
      return { ok: false, message: bpm.message, field: 'bpm', index };
    }

    blocks.push({
      id: stableId(row.id, () => idFactory('part')),
      name: name.value,
      measures: measures.value,
      bpm: bpm.value,
      order: index
    });
  }

  return { ok: true, blocks };
}

export function createDefaultNamedBlock(existingBlocksOrIndex = [], bpm = 100, { idFactory = DEFAULT_ID_FACTORY } = {}) {
  const index = Number.isInteger(existingBlocksOrIndex) ? existingBlocksOrIndex : nextPartNumber(existingBlocksOrIndex);
  return {
    id: idFactory('part'),
    name: `Parte ${index + 1}`,
    measures: 4,
    bpm,
    order: index
  };
}

export function sortBlocks(blocks) {
  return [...normalizeBlocks(blocks)].sort((left, right) => left.order - right.order).map((block, index) => ({ ...block, order: index }));
}

export function createSong({ name, blocks, now = new Date().toISOString(), idFactory = DEFAULT_ID_FACTORY }) {
  const parsedName = parseSongName(name);
  if (!parsedName.ok) {
    return { ok: false, message: parsedName.message, field: 'songName' };
  }

  const validatedBlocks = validateEditableBlocks(blocks, { idFactory });
  if (!validatedBlocks.ok) {
    return validatedBlocks;
  }

  const id = idFactory('song');
  return {
    ok: true,
    song: {
      id,
      schemaVersion: SONG_SCHEMA_VERSION,
      name: parsedName.value,
      blocks: validatedBlocks.blocks,
      createdAt: now,
      updatedAt: now
    }
  };
}

export function updateSong(song, { name = song?.name, blocks = song?.blocks, now = new Date().toISOString(), idFactory = DEFAULT_ID_FACTORY } = {}) {
  if (!song || typeof song !== 'object' || typeof song.id !== 'string' || !song.id) {
    return { ok: false, message: 'Canción inválida.' };
  }

  const next = createSong({ name, blocks, now, idFactory });
  if (!next.ok) {
    return next;
  }

  return {
    ok: true,
    song: {
      ...next.song,
      id: song.id,
      createdAt: typeof song.createdAt === 'string' ? song.createdAt : now,
      updatedAt: now
    }
  };
}

export function cloneSongAsNew(song, { name = song?.name, now = new Date().toISOString(), idFactory = DEFAULT_ID_FACTORY } = {}) {
  return createSong({
    name,
    blocks: normalizeBlocks(song?.blocks, { fallbackToDefault: false })?.map((block) => ({ ...block, id: idFactory('part') })) || [],
    now,
    idFactory
  });
}

export function sanitizeSongLibrary(value) {
  const songs = [];
  let discardedCount = 0;
  let migratedCount = 0;
  const rawSongs = Array.isArray(value?.songs) ? value.songs : [];

  for (const rawSong of rawSongs) {
    const normalized = normalizeSong(rawSong);
    if (normalized) {
      songs.push(normalized.song);
      migratedCount += normalized.migrated ? 1 : 0;
    } else {
      discardedCount += 1;
    }
  }

  return {
    schemaVersion: SONG_SCHEMA_VERSION,
    songs,
    discardedCount,
    migratedCount
  };
}

export function findSong(library, songId) {
  const sanitized = sanitizeSongLibrary(library);
  return sanitized.songs.find((song) => song.id === songId) || null;
}

export function upsertSongInLibrary(library, song) {
  const sanitized = sanitizeSongLibrary(library);
  const normalized = normalizeSong(song);
  if (!normalized) {
    return { ok: false, message: 'Canción inválida.' };
  }

  const songs = sanitized.songs.filter((item) => item.id !== normalized.song.id);
  songs.push(normalized.song);
  songs.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  return {
    ok: true,
    library: {
      schemaVersion: SONG_SCHEMA_VERSION,
      songs,
      discardedCount: sanitized.discardedCount,
      migratedCount: sanitized.migratedCount
    }
  };
}

export function renameSongInLibrary(library, songId, name, { now = new Date().toISOString() } = {}) {
  const sanitized = sanitizeSongLibrary(library);
  const song = sanitized.songs.find((item) => item.id === songId);
  if (!song) {
    return { ok: false, message: 'Canción no encontrada.' };
  }

  const renamed = updateSong(song, { name, now });
  if (!renamed.ok) {
    return renamed;
  }

  return upsertSongInLibrary(sanitized, renamed.song);
}

export function deleteSongFromLibrary(library, songId, { confirmed = false } = {}) {
  const sanitized = sanitizeSongLibrary(library);
  if (!confirmed) {
    return { ok: true, library: sanitized, deleted: false };
  }

  return {
    ok: true,
    deleted: sanitized.songs.some((song) => song.id === songId),
    library: {
      schemaVersion: SONG_SCHEMA_VERSION,
      songs: sanitized.songs.filter((song) => song.id !== songId),
      discardedCount: sanitized.discardedCount,
      migratedCount: sanitized.migratedCount
    }
  };
}

export function hasUnsavedBlockChanges(blocks, savedBlocks) {
  return serializeBlocks(blocks) !== serializeBlocks(savedBlocks);
}

export function serializeSongDraft({ name, blocks }) {
  return JSON.stringify({
    name: typeof name === 'string' ? name.trim() : '',
    blocks: normalizeBlocks(blocks, { fallbackToDefault: false })?.map((block, index) => ({
      name: block.name,
      measures: block.measures,
      bpm: block.bpm,
      order: index
    })) || []
  });
}

export function serializeBlocks(blocks) {
  return JSON.stringify(
    normalizeBlocks(blocks).map((block, index) => ({
      name: block.name,
      measures: block.measures,
      bpm: block.bpm,
      order: index
    }))
  );
}

export function moveBlock(blocks, fromIndex, toIndex) {
  const normalized = normalizeBlocks(blocks, { fallbackToDefault: false }) || [];
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= normalized.length ||
    toIndex >= normalized.length
  ) {
    return normalized.map((block, index) => ({ ...block, order: index }));
  }

  const next = [...normalized];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next.map((block, index) => ({ ...block, order: index }));
}

export function removeBlock(blocks, index) {
  const normalized = normalizeBlocks(blocks, { fallbackToDefault: false }) || [];
  if (!Number.isInteger(index) || index < 0 || index >= normalized.length || normalized.length === 1) {
    return { ok: false, blocks: normalized, message: 'La canción debe tener al menos una parte.' };
  }

  return {
    ok: true,
    blocks: normalized.filter((_, itemIndex) => itemIndex !== index).map((block, itemIndex) => ({ ...block, order: itemIndex }))
  };
}

export function createRuntime(blocks) {
  const normalized = normalizeBlocks(blocks);
  return {
    blockIndex: 0,
    measureInBlock: 1,
    beatInMeasure: 1,
    bpm: normalized[0].bpm,
    phase: 'playing',
    countInBeat: null
  };
}

export function createCountInRuntime(blockIndex, blocks) {
  const normalized = normalizeBlocks(blocks);
  const safeBlockIndex = clampBlockIndex(blockIndex, normalized);
  return {
    blockIndex: safeBlockIndex,
    measureInBlock: 1,
    beatInMeasure: 1,
    bpm: normalized[safeBlockIndex].bpm,
    phase: 'countIn',
    countInBeat: INITIAL_COUNT_IN_BEATS
  };
}

export function createPlaybackRuntime(blocks) {
  return createCountInRuntime(0, blocks);
}

export function advanceRuntime(runtime, blocks) {
  const normalized = normalizeBlocks(blocks);
  const currentBlock = normalized[runtime.blockIndex] || normalized[0];
  let blockIndex = runtime.blockIndex;
  let measureInBlock = runtime.measureInBlock;
  let beatInMeasure = runtime.beatInMeasure + 1;

  if (beatInMeasure > BEATS_PER_MEASURE) {
    beatInMeasure = 1;
    measureInBlock += 1;

    if (measureInBlock > currentBlock.measures) {
      blockIndex = (blockIndex + 1) % normalized.length;
      measureInBlock = 1;
    }
  }

  return {
    blockIndex,
    measureInBlock,
    beatInMeasure,
    bpm: normalized[blockIndex].bpm,
    phase: 'playing',
    countInBeat: null
  };
}

export function advancePlaybackRuntime(runtime, blocks) {
  const normalized = normalizeBlocks(blocks);

  if (runtime.phase === 'countIn') {
    if (runtime.countInBeat > 1) {
      return {
        ...runtime,
        countInBeat: runtime.countInBeat - 1
      };
    }
    return {
      blockIndex: runtime.blockIndex,
      measureInBlock: 1,
      beatInMeasure: 1,
      bpm: normalized[runtime.blockIndex].bpm,
      phase: 'playing',
      countInBeat: null
    };
  }

  return advanceRuntime(runtime, normalized);
}

export function getCurrentBlock(runtime, blocks) {
  const normalized = normalizeBlocks(blocks);
  return normalized[runtime.blockIndex] || normalized[0];
}

export function getNextBlock(runtime, blocks) {
  const normalized = normalizeBlocks(blocks);
  return normalized[(runtime.blockIndex + 1) % normalized.length] || normalized[0];
}

export function getAnnouncementWord(runtime, blocks) {
  const normalized = normalizeBlocks(blocks);
  const currentBlock = getCurrentBlock(runtime, normalized);

  if (runtime.phase === 'countIn') {
    if (runtime.countInBeat === INITIAL_COUNT_IN_BEATS) {
      return currentBlock.name;
    }
    return countInWord(runtime.countInBeat);
  }

  if (runtime.phase !== 'playing' || runtime.measureInBlock !== currentBlock.measures) {
    return null;
  }

  if (runtime.beatInMeasure === 1) {
    return getNextBlock(runtime, normalized).name;
  }
  return countInWord(BEATS_PER_MEASURE - runtime.beatInMeasure + 1);
}

export function selectPreferredVoice(voices = [], preferredVoiceURI = '') {
  if (!Array.isArray(voices) || voices.length === 0) {
    return null;
  }

  return (
    voices.find((voice) => preferredVoiceURI && voice?.voiceURI === preferredVoiceURI) ||
    voices.find((voice) => voice?.lang?.toLowerCase() === 'es-ar') ||
    voices.find((voice) => voice?.lang?.toLowerCase().startsWith('es-')) ||
    voices.find((voice) => voice?.lang?.toLowerCase().startsWith('es')) ||
    voices[0]
  );
}

export function createMetronomeMachine(blocks) {
  const normalized = normalizeBlocks(blocks);
  let runtime = createRuntime(normalized);
  let running = false;
  let paused = false;
  let schedulerActive = false;

  return {
    start() {
      if (schedulerActive) {
        return false;
      }
      running = true;
      paused = false;
      schedulerActive = true;
      return true;
    },
    pause() {
      if (!running || paused) {
        return false;
      }
      paused = true;
      schedulerActive = false;
      return true;
    },
    resume() {
      if (!running || !paused || schedulerActive) {
        return false;
      }
      paused = false;
      schedulerActive = true;
      return true;
    },
    stop() {
      running = false;
      paused = false;
      schedulerActive = false;
      runtime = createRuntime(normalized);
    },
    tick() {
      runtime = advanceRuntime(runtime, normalized);
      return this.snapshot();
    },
    snapshot() {
      return {
        runtime: { ...runtime },
        running,
        paused,
        schedulerActive
      };
    }
  };
}

export function createSongPlaybackMachine(blocks) {
  const normalized = normalizeBlocks(blocks);
  let runtime = createPlaybackRuntime(normalized);
  let running = false;
  let paused = false;
  let schedulerActive = false;

  return {
    start() {
      if (schedulerActive) {
        return false;
      }
      running = true;
      paused = false;
      schedulerActive = true;
      runtime = createPlaybackRuntime(normalized);
      return true;
    },
    pause() {
      if (!running || paused) {
        return false;
      }
      paused = true;
      schedulerActive = false;
      return true;
    },
    resume() {
      if (!running || !paused || schedulerActive) {
        return false;
      }
      paused = false;
      schedulerActive = true;
      return true;
    },
    stop() {
      running = false;
      paused = false;
      schedulerActive = false;
      runtime = createPlaybackRuntime(normalized);
    },
    restart() {
      running = true;
      paused = false;
      schedulerActive = true;
      runtime = createPlaybackRuntime(normalized);
      return true;
    },
    tick() {
      runtime = advancePlaybackRuntime(runtime, normalized);
      return this.snapshot();
    },
    snapshot() {
      return {
        runtime: { ...runtime },
        running,
        paused,
        schedulerActive,
        currentBlock: { ...getCurrentBlock(runtime, normalized) },
        nextBlock: { ...getNextBlock(runtime, normalized) }
      };
    }
  };
}

function normalizePlaybackBlock(block, index) {
  if (
    !block ||
    !Number.isInteger(block.measures) ||
    !Number.isInteger(block.bpm) ||
    block.measures < MIN_MEASURES ||
    block.measures > MAX_MEASURES ||
    block.bpm < MIN_BPM ||
    block.bpm > MAX_BPM
  ) {
    return null;
  }

  const parsedName = parsePartName(typeof block.name === 'string' ? block.name : `Parte ${index + 1}`);
  if (!parsedName.ok) {
    return null;
  }

  return {
    id: stableId(block.id, () => `part-${index + 1}`),
    name: parsedName.value,
    measures: block.measures,
    bpm: block.bpm,
    order: Number.isInteger(block.order) ? block.order : index
  };
}

function normalizeSong(rawSong) {
  if (!rawSong || typeof rawSong !== 'object') {
    return null;
  }
  if (![SONG_SCHEMA_VERSION, PREVIOUS_SONG_SCHEMA_VERSION].includes(rawSong.schemaVersion)) {
    return null;
  }

  const parsedName = parseSongName(rawSong.name);
  if (!parsedName.ok || typeof rawSong.id !== 'string' || !rawSong.id) {
    return null;
  }

  if (!Array.isArray(rawSong.blocks) || rawSong.blocks.length === 0 || rawSong.blocks.length > MAX_PARTS) {
    return null;
  }

  const blocks = [];
  for (let index = 0; index < rawSong.blocks.length; index += 1) {
    const block = normalizePlaybackBlock(rawSong.blocks[index], index);
    if (!block) {
      return null;
    }
    blocks.push(block);
  }

  return {
    migrated: rawSong.schemaVersion !== SONG_SCHEMA_VERSION,
    song: {
      id: rawSong.id,
      schemaVersion: SONG_SCHEMA_VERSION,
      name: parsedName.value,
      blocks: blocks.map((block, index) => ({ ...block, order: index })),
      createdAt: typeof rawSong.createdAt === 'string' ? rawSong.createdAt : new Date(0).toISOString(),
      updatedAt: typeof rawSong.updatedAt === 'string' ? rawSong.updatedAt : new Date(0).toISOString()
    }
  };
}

function nextPartNumber(blocks) {
  const normalized = Array.isArray(blocks) ? blocks : [];
  const used = new Set();
  for (const block of normalized) {
    const match = typeof block?.name === 'string' ? block.name.trim().match(/^Parte ([1-9]|[12][0-9]|3[0-2])$/) : null;
    if (match) {
      used.add(Number(match[1]));
    }
  }

  const preferred = normalized.length + 1;
  if (preferred <= MAX_PARTS && !used.has(preferred)) {
    return preferred - 1;
  }

  for (let value = 1; value <= MAX_PARTS; value += 1) {
    if (!used.has(value)) {
      return value - 1;
    }
  }
  return Math.min(normalized.length, MAX_PARTS - 1);
}

function stableId(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback();
}

function clampBlockIndex(blockIndex, blocks) {
  return Number.isInteger(blockIndex) && blockIndex >= 0 && blockIndex < blocks.length ? blockIndex : 0;
}

function countInWord(value) {
  if (value === 3) {
    return 'Tres';
  }
  if (value === 2) {
    return 'Dos';
  }
  if (value === 1) {
    return 'Uno';
  }
  return null;
}

function cloneDefaultBlocks() {
  return DEFAULT_BLOCKS.map((block) => ({ ...block }));
}
