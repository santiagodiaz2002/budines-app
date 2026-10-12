import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

let db;
afterEach(() => {
  db?.close();
  db = null;
});

const sharedTables = ['app_users', 'app_sessions', 'auth_rate_limits', 'chat_messages', 'songbook_songs', 'songbook_folders', 'songbook_imports'];

describe('esquema de cuentas, chat y cancionero', () => {
  it('crea solo las tablas compartidas, conserva usuarios y admite reaplicación', () => {
    db = new DatabaseSync(':memory:');
    const schema = readFileSync('database/schema.sql', 'utf8');
    db.exec(schema);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO app_users (
        id, username_normalized, display_name, password_hash, password_salt,
        password_algorithm, password_iterations, password_kdf_version,
        role, can_access_budines, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'PBKDF2-HMAC-SHA-256', 600000, 2, 'owner', 1, ?, ?)
    `).run('santi', 'santi', 'Santi', '00'.repeat(32), '11'.repeat(32), now, now);
    db.exec(schema);

    expect(db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    `).all().map((row) => row.name)).toEqual([...sharedTables].sort());
    expect(db.prepare('SELECT id, can_access_budines, password_kdf_version FROM app_users').get()).toEqual({
      id: 'santi', can_access_budines: 1, password_kdf_version: 2
    });
    expect(() => db.prepare('UPDATE app_users SET password_kdf_version = 3').run()).toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('retira la contabilidad preservando las cuentas, sesiones, controles de login y mensajes', () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('database/schema.sql', 'utf8'));
    db.exec(`
      INSERT INTO app_users (
        id, username_normalized, display_name, password_hash, password_salt,
        password_algorithm, password_iterations, password_kdf_version,
        role, can_access_budines, created_at, updated_at
      ) VALUES ('owner-test', 'owner-test', 'Owner-Test', '${'00'.repeat(32)}', '${'11'.repeat(32)}',
        'PBKDF2-HMAC-SHA-256', 600000, 2, 'owner', 1, '2026-01-01', '2026-01-01');
      INSERT INTO app_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
        VALUES ('test-session', 'owner-test', '${'22'.repeat(32)}', '2026-01-01', '2999-01-01', '2026-01-01');
      INSERT INTO auth_rate_limits (key, purpose, attempts, window_started_at, updated_at)
        VALUES ('test-rate-limit', 'login', 1, '2026-01-01', '2026-01-01');
      INSERT INTO chat_messages (user_id, content, request_id)
        VALUES ('owner-test', 'Mensaje de prueba', '00000000-0000-4000-8000-000000000001');

      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE config (value INTEGER);
      CREATE TABLE sessions (user_id TEXT REFERENCES users(id));
      CREATE TABLE records (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id));
      CREATE TABLE record_deletions (record_id TEXT REFERENCES records(id));
      CREATE TABLE operations (user_id TEXT REFERENCES users(id));
      CREATE TABLE accounting_resets (id TEXT PRIMARY KEY);
      CREATE TABLE accounting_exclusions (reset_id TEXT REFERENCES accounting_resets(id));
      INSERT INTO users VALUES ('legacy-test');
      INSERT INTO config VALUES (1);
      INSERT INTO sessions VALUES ('legacy-test');
      INSERT INTO records VALUES ('record-test', 'legacy-test');
      INSERT INTO record_deletions VALUES ('record-test');
      INSERT INTO operations VALUES ('legacy-test');
      INSERT INTO accounting_resets VALUES ('reset-test');
      INSERT INTO accounting_exclusions VALUES ('reset-test');
    `);
    const before = sharedTables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    const retirement = readFileSync('migrations/0011_retire_accounting.sql', 'utf8');
    db.exec(retirement);
    db.exec(retirement);

    expect(sharedTables.map((table) => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    expect(db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    `).all().map((row) => row.name)).toEqual([...sharedTables].sort());
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('agrega el cancionero sin modificar datos de autenticación y chat y permite reaplicación', () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('database/schema.sql', 'utf8').split('CREATE TABLE IF NOT EXISTS songbook_folders')[0]);
    db.exec(`
      INSERT INTO app_users (
        id, username_normalized, display_name, password_hash, password_salt,
        password_algorithm, password_iterations, password_kdf_version,
        role, can_access_budines, created_at, updated_at
      ) VALUES ('migration-user', 'migration-user', 'Migration-User', '${'00'.repeat(32)}', '${'11'.repeat(32)}',
        'PBKDF2-HMAC-SHA-256', 600000, 2, 'common', 0, '2026-01-01', '2026-01-01');
      INSERT INTO app_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
        VALUES ('migration-session', 'migration-user', '${'22'.repeat(32)}', '2026-01-01', '2999-01-01', '2026-01-01');
      INSERT INTO auth_rate_limits (key, purpose, attempts, window_started_at, updated_at)
        VALUES ('migration-limit', 'login', 2, '2026-01-01', '2026-01-01');
      INSERT INTO chat_messages (user_id, content, request_id)
        VALUES ('migration-user', 'Preservar mensaje', '00000000-0000-4000-8000-000000000012');
    `);
    const before = sharedTables.slice(0, 4).map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    const migration = readFileSync('migrations/0012_shared_songbook.sql', 'utf8');
    db.exec(migration);
    db.exec(migration);
    expect(sharedTables.slice(0, 4).map((table) => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name)).toEqual([...sharedTables].sort());
  });
});
