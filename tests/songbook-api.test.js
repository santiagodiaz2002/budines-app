import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../functions/_shared/auth.js';
import { onRequest as songbook } from '../functions/api/songbook.js';
import { onRequest as logout } from '../functions/api/logout.js';

const ORIGIN = 'https://budines.test';
const dbs = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

describe('cancionero compartido con sesiones del servidor', () => {
  it('requiere sesión para leer y para cada mutación, y protege origen y cache', async () => {
    const { invoke, cookies, db } = await setup();
    const anonymous = await invoke();
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('Cache-Control')).toBe('no-store');
    for (const action of ['createSong', 'updateSong', 'deleteSong', 'createFolder', 'renameFolder', 'deleteFolder', 'importSong']) {
      expect((await invoke({ body: { action } })).status).toBe(401);
    }
    expect((await invoke({ cookie: 'budines_session=invalid' })).status).toBe(401);
    expect((await invoke({ cookie: cookies.santi, body: { action: 'createSong', song: sample() }, origin: 'https://another.test' })).status).toBe(403);
    expect((await invoke({ cookie: cookies.santi, method: 'DELETE' })).status).toBe(405);
    const good = await invoke({ cookie: cookies.santi });
    expect(good.status).toBe(200);
    expect(good.headers.get('Cache-Control')).toBe('no-store');
    expect(await good.json()).toMatchObject({ songs: [], folders: [] });
    expect(db.prepare('SELECT count(*) AS n FROM songbook_songs').get().n).toBe(0);
  });

  it('Santi y Leandro crean y editan las mismas canciones y las recuperan con otra sesión', async () => {
    const { invoke, cookies, db, d1 } = await setup();
    const usersBefore = db.prepare('SELECT * FROM app_users').all();
    const chatBefore = db.prepare('SELECT * FROM chat_messages').all();
    const bySanti = await mutate(invoke, cookies.santi, { action: 'createSong', song: sample('shared-santi') });
    const byLeandro = await mutate(invoke, cookies.leandro, { action: 'createSong', song: sample('shared-leandro') });
    expect((await list(invoke, cookies.leandro)).songs).toContainEqual(bySanti.song);
    expect((await list(invoke, cookies.santi)).songs).toContainEqual(byLeandro.song);
    const editSanti = await mutate(invoke, cookies.leandro, { action: 'updateSong', song: { ...bySanti.song, name: 'Leandro la editó' } });
    const editLeandro = await mutate(invoke, cookies.santi, { action: 'updateSong', song: { ...byLeandro.song, name: 'Santi la editó' } });
    expect((await list(invoke, cookies.santi)).songs).toContainEqual(editSanti.song);
    expect((await list(invoke, cookies.leandro)).songs).toContainEqual(editLeandro.song);
    expect(editSanti.song.revision).toBe(2);
    expect(editSanti.song.createdAt).toBe(bySanti.song.createdAt);
    expect((await logout({ request: request({ cookie: cookies.santi, method: 'POST', path: '/api/logout' }), env: { DB: d1 } })).status).toBe(200);
    expect((await invoke({ cookie: cookies.santi })).status).toBe(401);
    const again = await createSession(d1, {}, 'santi', ORIGIN);
    expect((await list(invoke, again.cookie)).songs).toContainEqual(editSanti.song);
    // A common account has the same global editing permissions, without trusting roles from requests.
    expect((await invoke({ cookie: cookies.common, body: { action: 'updateSong', song: { ...editSanti.song, name: 'Cuenta común', userId: 'santi' } } })).status).toBe(200);
    expect(db.prepare('SELECT * FROM app_users').all()).toEqual(usersBefore);
    expect(db.prepare('SELECT * FROM chat_messages').all()).toEqual(chatBefore);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('comparte carpetas, permite mover canciones y elimina carpetas devolviendo sus canciones a la raíz', async () => {
    const { invoke, cookies } = await setup();
    const { folder } = await mutate(invoke, cookies.santi, { action: 'createFolder', id: 'folder-one', name: 'Banda' });
    expect((await list(invoke, cookies.leandro)).folders).toEqual([folder]);
    const root = await mutate(invoke, cookies.leandro, { action: 'createSong', song: sample('root-song') });
    const inside = await mutate(invoke, cookies.santi, { action: 'createSong', song: { ...sample('inside-song'), folderId: folder.id } });
    const moved = await mutate(invoke, cookies.leandro, { action: 'updateSong', song: { ...root.song, folderId: folder.id } });
    expect(moved.song.blocks).toEqual(root.song.blocks);
    const second = await mutate(invoke, cookies.leandro, { action: 'createFolder', id: 'folder-two', name: 'Otra banda' });
    const elsewhere = await mutate(invoke, cookies.santi, { action: 'updateSong', song: { ...moved.song, folderId: second.folder.id } });
    expect(elsewhere.song.blocks).toEqual(root.song.blocks);
    expect((await invoke({ cookie: cookies.santi, body: { action: 'deleteFolder', id: folder.id, revision: folder.revision } })).status).toBe(400);
    expect((await list(invoke, cookies.santi)).songs.find((song) => song.id === inside.song.id).folderId).toBe(folder.id);
    const removed = await mutate(invoke, cookies.leandro, { action: 'deleteFolder', id: folder.id, revision: folder.revision, confirmed: true });
    expect(removed).toMatchObject({ deleted: true, movedSongs: 1 });
    const after = await list(invoke, cookies.santi);
    expect(after.songs).toHaveLength(2);
    expect(after.folders).toEqual([second.folder]);
    const returned = after.songs.find((song) => song.id === inside.song.id);
    expect(returned).toMatchObject({ folderId: null, revision: inside.song.revision + 1, blocks: inside.song.blocks });
    const rootAgain = await mutate(invoke, cookies.leandro, { action: 'updateSong', song: { ...elsewhere.song, folderId: null } });
    expect(rootAgain.song.folderId).toBeNull();
    expect(rootAgain.song.blocks).toEqual(root.song.blocks);
    expect((await invoke({ cookie: cookies.santi, body: { action: 'updateSong', song: inside.song } })).status).toBe(409);
  });

  it('rechaza escrituras y eliminaciones obsoletas sin sobrescribir contenido reciente', async () => {
    const { invoke, cookies } = await setup();
    const { song } = await mutate(invoke, cookies.santi, { action: 'createSong', song: sample() });
    const edited = await mutate(invoke, cookies.leandro, { action: 'updateSong', song: { ...song, name: 'Versión reciente' } });
    for (const body of [
      { action: 'updateSong', song: { ...song, name: 'Versión obsoleta' } },
      { action: 'deleteSong', id: song.id, revision: song.revision }
    ]) expect((await invoke({ cookie: cookies.santi, body })).status).toBe(409);
    expect((await list(invoke, cookies.santi)).songs).toEqual([edited.song]);
    const { folder } = await mutate(invoke, cookies.santi, { action: 'createFolder', id: 'conflict-folder', name: 'Anterior' });
    const renamed = await mutate(invoke, cookies.leandro, { action: 'renameFolder', id: folder.id, name: 'Reciente', revision: folder.revision });
    const moved = await mutate(invoke, cookies.leandro, { action: 'updateSong', song: { ...edited.song, folderId: folder.id } });
    expect((await invoke({ cookie: cookies.santi, body: { action: 'deleteFolder', id: folder.id, revision: folder.revision, confirmed: true } })).status).toBe(409);
    expect((await list(invoke, cookies.santi)).folders).toEqual([renamed.folder]);
    expect((await list(invoke, cookies.santi)).songs).toEqual([moved.song]);
  });

  it('solo permite una de dos ediciones concurrentes con la misma revisión', async () => {
    const { invoke, cookies } = await setup();
    const { song } = await mutate(invoke, cookies.santi, { action: 'createSong', song: sample() });
    const responses = await Promise.all([
      invoke({ cookie: cookies.santi, body: { action: 'updateSong', song: { ...song, name: 'Edición Santi' } } }),
      invoke({ cookie: cookies.leandro, body: { action: 'updateSong', song: { ...song, name: 'Edición Leandro' } } })
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const accepted = await responses.find((response) => response.status === 200).json();
    expect((await list(invoke, cookies.leandro)).songs).toEqual([accepted.song]);
  });

  it('revierte toda la operación si falla el segundo paso de eliminar una carpeta o de importar', async () => {
    const { invoke, cookies, db } = await setup();
    const { folder } = await mutate(invoke, cookies.santi, { action: 'createFolder', id: 'atomic-folder', name: 'Conservar' });
    const { song } = await mutate(invoke, cookies.leandro, { action: 'createSong', song: { ...sample(), folderId: folder.id } });
    db.exec("CREATE TRIGGER fail_folder_delete BEFORE DELETE ON songbook_folders BEGIN SELECT RAISE(ABORT, 'Injected transaction failure'); END");
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await invoke({ cookie: cookies.santi, body: { action: 'deleteFolder', id: folder.id, revision: folder.revision, confirmed: true } })).status).toBe(500);
      const after = await list(invoke, cookies.leandro);
      expect(after.songs).toEqual([song]);
      expect(after.folders).toEqual([folder]);
      db.exec("CREATE TRIGGER fail_song_insert BEFORE INSERT ON songbook_songs BEGIN SELECT RAISE(ABORT, 'Injected import failure'); END");
      expect((await invoke({ cookie: cookies.santi, body: { action: 'importSong', song: { ...sample('atomic-local'), createdAt: '2026-01-01', updatedAt: '2026-01-01' } } })).status).toBe(500);
      expect(db.prepare('SELECT count(*) AS n FROM songbook_imports').get().n).toBe(0);
      expect((await list(invoke, cookies.santi)).songs).toEqual([song]);
    } finally { errors.mockRestore(); }
  });

  it('importa originales una sola vez, conserva títulos iguales y variantes, y nunca revive una importación eliminada', async () => {
    const { invoke, cookies, db } = await setup();
    const local = { ...sample('legacy-song'), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', schemaVersion: 2 };
    const first = await mutate(invoke, cookies.santi, { action: 'importSong', song: local });
    const alias = await mutate(invoke, cookies.leandro, { action: 'importSong', song: structuredClone(local) });
    expect(first).toMatchObject({ imported: true, skipped: false, deleted: false });
    expect(alias).toMatchObject({ imported: true, skipped: true, deleted: false, importedId: first.song.id });
    expect(first.song.createdAt).toBe(local.createdAt);
    expect(first.song.updatedAt).toBe(local.updatedAt);
    expect(first.song.blocks).toEqual(local.blocks);
    const sameTitle = await mutate(invoke, cookies.leandro, { action: 'importSong', song: { ...local, id: 'different-legacy-id' } });
    const variant = await mutate(invoke, cookies.leandro, { action: 'importSong', song: { ...local, blocks: [{ ...local.blocks[0], bpm: 140 }] } });
    expect(new Set([first.song.id, sameTitle.song.id, variant.song.id]).size).toBe(3);
    await mutate(invoke, cookies.leandro, { action: 'deleteSong', id: first.song.id, revision: first.song.revision });
    const replay = await mutate(invoke, cookies.santi, { action: 'importSong', song: local });
    expect(replay).toMatchObject({ imported: true, skipped: true, deleted: true, song: null, importedId: first.song.id });
    expect((await list(invoke, cookies.santi)).songs).toHaveLength(2);
    expect(db.prepare('SELECT count(*) AS n FROM songbook_imports').get().n).toBe(3);
  });

  it('reintenta creaciones con identificadores estables sin duplicar y detecta colisiones de contenido', async () => {
    const { invoke, cookies } = await setup();
    const create = { action: 'createSong', song: sample() };
    const first = await mutate(invoke, cookies.santi, create);
    expect(await mutate(invoke, cookies.leandro, create)).toEqual(first);
    expect((await invoke({ cookie: cookies.santi, body: { ...create, song: { ...create.song, name: 'Otro contenido' } } })).status).toBe(409);
    const folder = { action: 'createFolder', id: 'retry-folder', name: 'Compartida' };
    expect(await mutate(invoke, cookies.santi, folder)).toEqual(await mutate(invoke, cookies.leandro, folder));
    expect((await invoke({ cookie: cookies.santi, body: { ...folder, name: 'Distinta' } })).status).toBe(409);
    expect((await list(invoke, cookies.leandro)).songs).toHaveLength(1);
  });

  it('valida música y aceleraciones en backend y guarda hasta 32 partes sin truncamiento', async () => {
    const { invoke, cookies } = await setup();
    const ramp = { enabled: true, targetBpm: 140, measures: 1 };
    const big = { ...sample('large-song'), name: 'N'.repeat(80), blocks: Array.from({ length: 32 }, (_, index) => ({ id: `part-${index}`, name: 'P'.repeat(40), measures: 999, bpm: 100, order: index, ramp })) };
    expect(JSON.stringify({ action: 'createSong', song: big }).length).toBeGreaterThan(4096);
    const { song } = await mutate(invoke, cookies.santi, { action: 'createSong', song: big });
    expect(song.blocks).toEqual(big.blocks);
    for (const blocks of [
      [], Array.from({ length: 33 }, () => sample().blocks[0]),
      [{ ...sample().blocks[0], bpm: '100' }],
      [{ ...sample().blocks[0], bpm: 301 }],
      [{ ...sample().blocks[0], measures: 0 }],
      [{ ...sample().blocks[0], ramp: { ...ramp, measures: 5 } }],
      [{ ...sample().blocks[0], ramp: { ...ramp, targetBpm: 90 } }],
      [{ ...sample().blocks[0], ramp: { ...ramp, enabled: 'true' } }]
    ]) expect((await invoke({ cookie: cookies.santi, body: { action: 'createSong', song: { ...sample(crypto.randomUUID()), blocks } } })).status).toBe(400);
    expect((await invoke({ cookie: cookies.santi, body: { action: 'createSong', song: { ...sample('missing-folder'), folderId: 'missing' } } })).status).toBe(409);
    expect((await invoke({ cookie: cookies.santi, body: { action: 'importSong', song: { ...sample(), createdAt: 'bad', updatedAt: 'bad' } } })).status).toBe(400);
    expect((await invoke({ cookie: cookies.santi, body: { action: 'createSong', song: { ...sample('long-name'), name: 'x'.repeat(81) } } })).status).toBe(400);
  });

  it('revoca y vence sesiones de forma efectiva para todo el cancionero', async () => {
    const { invoke, cookies, db } = await setup();
    db.prepare("UPDATE app_sessions SET created_at = '1999-01-01', expires_at = '2000-01-01' WHERE user_id = ?").run('santi');
    expect((await invoke({ cookie: cookies.santi })).status).toBe(401);
    expect((await invoke({ cookie: cookies.santi, body: { action: 'createSong', song: sample() } })).status).toBe(401);
    db.prepare('UPDATE app_sessions SET revoked_at = ? WHERE user_id = ?').run(new Date().toISOString(), 'leandro');
    expect((await invoke({ cookie: cookies.leandro })).status).toBe(401);
  });
});

function sample(id = 'song-stable-id') {
  return { id, name: 'Canción de prueba', folderId: null, blocks: [{ id: 'part-one', name: 'Intro', measures: 4, bpm: 100, order: 0 }] };
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('database/schema.sql', 'utf8'));
  dbs.push(db);
  for (const [id, displayName, role, access] of [['santi', 'Santi', 'owner', 1], ['leandro', 'Leandro', 'owner', 1], ['common', 'Común', 'common', 0]]) {
    db.prepare(`INSERT INTO app_users (id, username_normalized, display_name, password_hash, password_salt,
      password_algorithm, password_iterations, password_kdf_version, role, can_access_budines, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'PBKDF2-HMAC-SHA-256', 600000, 2, ?, ?, '2026-01-01', '2026-01-01')`)
      .run(id, id, displayName, '00'.repeat(32), '11'.repeat(32), role, access);
  }
  const d1 = wrapD1(db);
  const cookies = {};
  for (const id of ['santi', 'leandro', 'common']) cookies[id] = (await createSession(d1, {}, id, ORIGIN)).cookie;
  const invoke = (options = {}) => songbook({ request: request(options), env: { DB: d1 } });
  return { db, d1, cookies, invoke };
}

function wrapD1(db) {
  function prepare(sql, bindings = []) {
    const statement = db.prepare(sql);
    return {
      bind(...values) { return prepare(sql, values); },
      async first() { return statement.get(...bindings) || null; },
      async all() { return { results: statement.all(...bindings) }; },
      async run() { const result = statement.run(...bindings); return { meta: { changes: Number(result.changes) }, results: [] }; },
      result() {
        if (statement.columns().length) return { results: statement.all(...bindings), meta: { changes: db.prepare('SELECT changes() AS changes').get().changes } };
        const result = statement.run(...bindings);
        return { results: [], meta: { changes: Number(result.changes) } };
      }
    };
  }
  return {
    prepare,
    async batch(statements) {
      db.exec('BEGIN');
      try { const results = statements.map((statement) => statement.result()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
}

function request({ method, body, cookie, origin = ORIGIN, path = '/api/songbook' } = {}) {
  method ||= body ? 'POST' : 'GET';
  const headers = new Headers({ Accept: 'application/json' });
  if (method !== 'GET') headers.set('Origin', origin);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  return new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function mutate(invoke, cookie, body) {
  const response = await invoke({ cookie, body });
  const result = await response.json();
  expect(response.status, JSON.stringify(result)).toBe(200);
  return result;
}

async function list(invoke, cookie) {
  const response = await invoke({ cookie });
  expect(response.status).toBe(200);
  return response.json();
}
