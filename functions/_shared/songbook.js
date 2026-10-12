import { sha256Hex } from './crypto.js';
import { ApiError } from './http.js';

const SELECT_SONG = 'SELECT id, name, blocks_json, folder_id, revision, created_at, updated_at FROM songbook_songs';
const SELECT_FOLDER = 'SELECT id, name, revision, created_at, updated_at FROM songbook_folders';

export async function listSongbook(db) {
  // One transaction returns folders and songs from the same database snapshot.
  const [songs, folders] = await db.batch([
    db.prepare(`${SELECT_SONG} ORDER BY updated_at DESC, id ASC`),
    db.prepare(`${SELECT_FOLDER} ORDER BY name COLLATE NOCASE ASC, id ASC`)
  ]);
  return { songs: songs.results.map(serializeSong), folders: folders.results.map(serializeFolder) };
}

export async function mutateSongbook(db, body) {
  const now = new Date().toISOString();
  switch (body.action) {
    case 'createSong': return createSong(db, body.song, now);
    case 'updateSong': return updateSong(db, body.song, now);
    case 'deleteSong': return deleteSong(db, body.id, body.revision);
    case 'createFolder': return createFolder(db, body.id, body.name, now);
    case 'renameFolder': return renameFolder(db, body.id, body.name, body.revision, now);
    case 'deleteFolder': return deleteFolder(db, body.id, body.revision, body.confirmed, now);
    case 'importSong': return importSong(db, body.song, body.importKey, now);
    default: throw new ApiError(400, 'invalid_action', 'La operación del cancionero no es válida.');
  }
}

async function createSong(db, raw, now) {
  const song = validateSong(raw);
  await db.prepare(`INSERT INTO songbook_songs (id, name, blocks_json, folder_id, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM songbook_folders WHERE id = ?)
    ON CONFLICT(id) DO NOTHING`)
    .bind(song.id, song.name, JSON.stringify(song.blocks), song.folderId, now, now, song.folderId, song.folderId).run();
  const row = await db.prepare(`${SELECT_SONG} WHERE id = ?`).bind(song.id).first();
  if (!row) {
    await assertFolder(db, song.folderId);
    throw new ApiError(409, 'song_missing', 'No se pudo guardar la canción. Conservamos tus cambios; volvé a intentar.');
  }
  const existing = serializeSong(row);
  if (!sameSongContent(existing, song)) conflict();
  return { song: existing };
}

async function updateSong(db, raw, now) {
  const song = validateSong(raw);
  const revision = validateRevision(raw.revision);
  const row = await db.prepare(`UPDATE songbook_songs SET name = ?, blocks_json = ?, folder_id = ?,
    revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?
    AND (? IS NULL OR EXISTS (SELECT 1 FROM songbook_folders WHERE id = ?)) RETURNING *`)
    .bind(song.name, JSON.stringify(song.blocks), song.folderId, now, song.id, revision, song.folderId, song.folderId).first();
  if (!row) {
    await assertFolder(db, song.folderId);
    await missingOrConflict(db, 'songbook_songs', song.id);
  }
  return { song: serializeSong(row) };
}

async function deleteSong(db, rawId, rawRevision) {
  const id = validateId(rawId);
  const revision = validateRevision(rawRevision);
  const row = await db.prepare('DELETE FROM songbook_songs WHERE id = ? AND revision = ? RETURNING id')
    .bind(id, revision).first();
  if (!row) await missingOrConflict(db, 'songbook_songs', id);
  return { deleted: true, id };
}

async function createFolder(db, rawId, rawName, now) {
  const id = validateId(rawId);
  const name = validateName(rawName, 'carpeta', 80);
  await db.prepare(`INSERT INTO songbook_folders (id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(id, name, now, now).run();
  const folder = serializeFolder(await db.prepare(`${SELECT_FOLDER} WHERE id = ?`).bind(id).first());
  if (folder.name !== name) conflict();
  return { folder };
}

async function renameFolder(db, rawId, rawName, rawRevision, now) {
  const id = validateId(rawId);
  const name = validateName(rawName, 'carpeta', 80);
  const revision = validateRevision(rawRevision);
  const row = await db.prepare(`UPDATE songbook_folders SET name = ?, revision = revision + 1,
    updated_at = ? WHERE id = ? AND revision = ? RETURNING *`).bind(name, now, id, revision).first();
  if (!row) await missingOrConflict(db, 'songbook_folders', id);
  return { folder: serializeFolder(row) };
}

async function deleteFolder(db, rawId, rawRevision, confirmed, now) {
  const id = validateId(rawId);
  const revision = validateRevision(rawRevision);
  if (confirmed !== true) {
    throw new ApiError(400, 'confirmation_required', 'Confirmá la eliminación de la carpeta. Sus canciones vuelven a la raíz.');
  }
  const results = await db.batch([
    db.prepare(`UPDATE songbook_songs SET folder_id = NULL, revision = revision + 1, updated_at = ?
      WHERE folder_id = ? AND EXISTS (SELECT 1 FROM songbook_folders WHERE id = ? AND revision = ?)`)
      .bind(now, id, id, revision),
    db.prepare('DELETE FROM songbook_folders WHERE id = ? AND revision = ? RETURNING id').bind(id, revision)
  ]);
  if (!results[1].results.length) await missingOrConflict(db, 'songbook_folders', id);
  return { deleted: true, id, movedSongs: Number(results[0].meta?.changes || 0) };
}

async function importSong(db, raw, providedKey, now) {
  if (providedKey !== undefined && (typeof providedKey !== 'string' || !/^[a-f0-9]{64}$/i.test(providedKey))) {
    throw new ApiError(400, 'invalid_import_key', 'La identificación de la importación no es válida.');
  }
  const song = validateSong(raw, { legacy: true });
  const createdAt = validateLegacyDate(raw.createdAt);
  const updatedAt = validateLegacyDate(raw.updatedAt);
  // User scope is deliberately excluded: unscoped and scoped backups may be aliases.
  // Identity + complete musical content distinguishes songs that share a title.
  const importKey = await sha256Hex(JSON.stringify({ id: song.id, createdAt, name: song.name, blocks: song.blocks }));
  const proposedId = crypto.randomUUID();
  const [ledger] = await db.batch([
    db.prepare(`INSERT INTO songbook_imports (import_key, song_id, imported_at)
      VALUES (?, ?, ?) ON CONFLICT(import_key) DO NOTHING RETURNING song_id`).bind(importKey, proposedId, now),
    db.prepare(`INSERT INTO songbook_songs (id, name, blocks_json, folder_id, created_at, updated_at)
      SELECT ?, ?, ?, NULL, ?, ? WHERE EXISTS (
        SELECT 1 FROM songbook_imports WHERE import_key = ? AND song_id = ?
      ) ON CONFLICT(id) DO NOTHING`).bind(proposedId, song.name, JSON.stringify(song.blocks), createdAt, updatedAt, importKey, proposedId)
  ]);
  const stored = await db.prepare('SELECT song_id FROM songbook_imports WHERE import_key = ?').bind(importKey).first();
  const row = await db.prepare(`${SELECT_SONG} WHERE id = ?`).bind(stored.song_id).first();
  return {
    song: row ? serializeSong(row) : null,
    importedId: stored.song_id,
    imported: true,
    skipped: !ledger.results.length,
    deleted: !row
  };
}

export function validateSong(raw, { legacy = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidSong();
  const id = legacy ? validateLegacyId(raw.id) : validateId(raw.id);
  const name = validateName(raw.name, 'canción', 80);
  if (!Array.isArray(raw.blocks) || raw.blocks.length < 1 || raw.blocks.length > 32) invalidSong();
  const blocks = raw.blocks.map((block, index) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) invalidSong();
    const part = {
      id: validateLegacyId(block.id),
      name: validateName(block.name, 'parte', 40),
      measures: validateInteger(block.measures, 1, 999, 'compases'),
      bpm: validateInteger(block.bpm, 30, 300, 'BPM'),
      order: index
    };
    if (block.ramp !== undefined) {
      if (!block.ramp || typeof block.ramp !== 'object' || Array.isArray(block.ramp) || typeof block.ramp.enabled !== 'boolean') invalidSong();
      const targetBpm = validateInteger(block.ramp.targetBpm, 30, 300, 'BPM objetivo');
      const measures = validateInteger(block.ramp.measures, 1, part.measures, 'compases de la aceleración');
      if (block.ramp.enabled && targetBpm <= part.bpm) {
        throw new ApiError(400, 'invalid_ramp', 'El BPM objetivo de la aceleración debe superar al inicial.');
      }
      part.ramp = { enabled: block.ramp.enabled, targetBpm, measures };
    }
    return part;
  });
  const folderId = legacy || raw.folderId === undefined || raw.folderId === null ? null : validateId(raw.folderId);
  return { id, name, blocks, folderId };
}

function serializeSong(row) {
  return {
    id: row.id, schemaVersion: 2, name: row.name, blocks: JSON.parse(row.blocks_json),
    folderId: row.folder_id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function serializeFolder(row) {
  return { id: row.id, name: row.name, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

function validateName(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new ApiError(400, 'invalid_name', `El nombre de la ${label} debe tener entre 1 y ${max} caracteres.`);
  }
  return value.trim();
}

function validateId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(value)) {
    throw new ApiError(400, 'invalid_id', 'La identificación no es válida.');
  }
  return value;
}

function validateLegacyId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) invalidSong();
  return value;
}

function validateRevision(value) {
  return validateInteger(value, 1, Number.MAX_SAFE_INTEGER, 'versión');
}

function validateInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError(400, 'invalid_song', `El valor de ${label} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

function validateLegacyDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new ApiError(400, 'invalid_song', 'La fecha de la canción local no es válida. La copia original se conserva.');
  }
  return new Date(value).toISOString();
}

async function assertFolder(db, folderId) {
  if (folderId && !await db.prepare('SELECT id FROM songbook_folders WHERE id = ?').bind(folderId).first()) {
    throw new ApiError(409, 'folder_missing', 'La carpeta ya no está disponible. Elegí otra carpeta o canciones sin carpeta.');
  }
}

async function missingOrConflict(db, table, id) {
  // Table comes only from the two internal call sites, never from request data.
  if (!await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first()) {
    throw new ApiError(404, 'not_found', 'La canción o carpeta ya no está disponible. Actualizá el cancionero.');
  }
  conflict();
}

function sameSongContent(left, right) {
  return left.name === right.name && left.folderId === right.folderId && JSON.stringify(left.blocks) === JSON.stringify(right.blocks);
}

function invalidSong() {
  throw new ApiError(400, 'invalid_song', 'La canción debe tener entre 1 y 32 partes con nombres, compases y BPM válidos.');
}

function conflict() {
  throw new ApiError(409, 'revision_conflict', 'Otra persona modificó este contenido. Conservamos tus cambios en el editor; actualizá el cancionero antes de guardar.');
}
