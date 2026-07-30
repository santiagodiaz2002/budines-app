import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

let db;

afterEach(() => {
  db?.close();
  db = null;
});

describe('migración 0005_track_password_kdf_version', () => {
  it('marca hashes existentes como legado y admite la versión estándar', () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
    db.exec(readFileSync('migrations/0002_remove_incorrect_62000_record.sql', 'utf8'));
    db.exec(readFileSync('migrations/0003_password_auth.sql', 'utf8'));
    insertUser('legacy-before-migration');

    db.exec(readFileSync('migrations/0005_track_password_kdf_version.sql', 'utf8'));

    expect(
      db.prepare('SELECT password_kdf_version FROM app_users WHERE id = ?').get('legacy-before-migration')
    ).toEqual({
      password_kdf_version: 1
    });

    db.prepare('UPDATE app_users SET password_kdf_version = 2 WHERE id = ?').run('legacy-before-migration');
    expect(
      db.prepare('SELECT password_kdf_version FROM app_users WHERE id = ?').get('legacy-before-migration')
    ).toEqual({
      password_kdf_version: 2
    });
    expect(() =>
      db.prepare('UPDATE app_users SET password_kdf_version = 3 WHERE id = ?').run('legacy-before-migration')
    ).toThrow();
  });
});

function insertUser(id) {
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO app_users (
        id,
        username_normalized,
        display_name,
        password_hash,
        password_salt,
        password_algorithm,
        password_iterations,
        role,
        can_access_budines,
        created_at,
        updated_at,
        disabled_at
      )
      VALUES (?, ?, ?, ?, ?, 'PBKDF2-HMAC-SHA-256', 600000, 'common', 0, ?, ?, NULL)
    `
  ).run(id, id, id, '00'.repeat(32), '11'.repeat(32), now, now);
}
