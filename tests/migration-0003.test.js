import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

let db;

afterEach(() => {
  db?.close();
  db = null;
});

describe('migracion 0003_password_auth', () => {
  it('crea tablas de auth, revoca sesiones viejas y conserva datos comerciales', () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
    db.exec(readFileSync('migrations/0002_remove_incorrect_62000_record.sql', 'utf8'));
    db.exec(`
      INSERT INTO sessions (
        id,
        user_id,
        token_hash,
        created_at,
        expires_at,
        revoked_at,
        last_used_at
      )
      VALUES (
        'legacy-session',
        'santi',
        '${'a'.repeat(64)}',
        '2026-07-20T00:00:00.000Z',
        '2999-01-01T00:00:00.000Z',
        NULL,
        '2026-07-20T00:00:00.000Z'
      );
    `);

    const before = commercialSnapshot();
    const migration = readFileSync('migrations/0003_password_auth.sql', 'utf8');
    db.exec(migration);
    db.exec(migration);
    const after = commercialSnapshot();

    expect(after).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('app_users', 'app_sessions', 'auth_rate_limits')").get().count).toBe(3);
    expect(db.prepare('SELECT revoked_at FROM sessions WHERE id = ?').get('legacy-session').revoked_at).toBeTypeOf('string');
    expect(db.prepare('SELECT COUNT(*) AS count FROM app_users').get().count).toBe(0);

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
          updated_at
        )
        VALUES (
          'common-1',
          'comun',
          'Comun',
          ?,
          ?,
          'PBKDF2-HMAC-SHA-256',
          600000,
          'common',
          0,
          '2026-07-20T00:00:00.000Z',
          '2026-07-20T00:00:00.000Z'
        )
      `
    ).run('b'.repeat(64), 'c'.repeat(64));

    expect(db.prepare('SELECT role, can_access_budines FROM app_users WHERE username_normalized = ?').get('comun')).toEqual({
      role: 'common',
      can_access_budines: 0
    });
  });
});

function commercialSnapshot() {
  const recordCount = db.prepare('SELECT COUNT(*) AS count FROM records').get().count;
  const deletionCount = db.prepare('SELECT COUNT(*) AS count FROM record_deletions').get().count;
  const total = db.prepare(`
    SELECT COALESCE(SUM(r.amount_ars), 0) AS total_ars
    FROM records r
    LEFT JOIN record_deletions rd ON rd.record_id = r.id
    WHERE r.status = 'activo'
      AND rd.record_id IS NULL
  `).get().total_ars;

  return {
    recordCount,
    deletionCount,
    total
  };
}
