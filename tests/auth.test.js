import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, getCurrentSession, requireBudinesAccess, requireSession } from '../functions/_shared/auth.js';
import { PASSWORD_ITERATIONS, PBKDF2_MAX_ITERATIONS_PER_DERIVE } from '../functions/_shared/constants.js';
import {
  deriveLegacyPasswordHash,
  derivePbkdf2PasswordHash,
  splitPbkdf2Iterations
} from '../functions/_shared/password-kdf.js';
import { onRequest as loginEndpoint } from '../functions/api/login.js';
import { onRequest as logoutEndpoint } from '../functions/api/logout.js';
import { onRequest as ownerSummaryEndpoint } from '../functions/api/owner-summary.js';
import { onRequest as recordsEndpoint } from '../functions/api/records/index.js';
import { onRequest as registerEndpoint } from '../functions/api/register.js';
import { onRequest as sessionEndpoint } from '../functions/api/session.js';
import { onRequest as summaryEndpoint } from '../functions/api/summary.js';
import { onRequest as voidEndpoint } from '../functions/api/records/[id]/void.js';

const ORIGIN = 'https://budines.test';
const OWNER_TEST_PASSWORD = 'owner-test-password';
const COMMON_TEST_PASSWORD = 'common-test-password';

let ownerPasswordData;
let dbs = [];

beforeAll(async () => {
  ownerPasswordData = {
    santi: await hashPassword(OWNER_TEST_PASSWORD),
    leandro: await hashPassword(OWNER_TEST_PASSWORD)
  };
});

afterEach(() => {
  for (const db of dbs) {
    db.close();
  }
  dbs = [];
});

afterAll(() => {
  dbs = [];
});

describe('autenticación por usuario y contraseña', () => {
  it('aplica 600.000 iteraciones PBKDF2 en bloques compatibles con Cloudflare', () => {
    const chunks = splitPbkdf2Iterations(PASSWORD_ITERATIONS);

    expect(chunks.reduce((total, chunk) => total + chunk, 0)).toBe(PASSWORD_ITERATIONS);
    expect(Math.max(...chunks)).toBeLessThanOrEqual(PBKDF2_MAX_ITERATIONS_PER_DERIVE);
  });

  it('registra cuenta común, normaliza username, auto-inicia sesión e ignora roles enviados', async () => {
    const { d1, db } = createTestD1();

    const response = await register(d1, {
      username: 'Nueva.User_1',
      password: COMMON_TEST_PASSWORD,
      role: 'owner'
    });
    const body = await response.json();
    const cookie = response.headers.get('Set-Cookie');
    const row = db
      .prepare('SELECT username_normalized, display_name, role, can_access_budines FROM app_users WHERE display_name = ?')
      .get('Nueva.User_1');

    expect(response.status).toBe(201);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(body.user).toEqual({
      id: expect.any(String),
      displayName: 'Nueva.User_1',
      capabilities: {
        canAccessBudines: false
      }
    });
    expect(row).toEqual({
      username_normalized: 'nueva.user_1',
      display_name: 'Nueva.User_1',
      role: 'common',
      can_access_budines: 0
    });
    expect(await currentSessionBody(d1, cookie)).toMatchObject({
      authenticated: true,
      user: {
        displayName: 'Nueva.User_1',
        capabilities: {
          canAccessBudines: false
        }
      }
    });
  });

  it('rechaza duplicados sin distinguir mayúsculas y no permite registrar owners reservados', async () => {
    const { d1 } = createTestD1();

    expect((await register(d1, { username: 'Comun', password: COMMON_TEST_PASSWORD })).status).toBe(201);

    const duplicate = await register(d1, { username: 'cOmUn', password: COMMON_TEST_PASSWORD });
    const reserved = await register(d1, { username: 'SANTI', password: COMMON_TEST_PASSWORD });

    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe('username_unavailable');
    expect(reserved.status).toBe(409);
    expect((await reserved.json()).error.code).toBe('username_unavailable');
  });

  it('valida usuario y contraseña de registro', async () => {
    const { d1 } = createTestD1();

    const badUsername = await register(d1, { username: 'con espacios', password: COMMON_TEST_PASSWORD });
    const shortPassword = await register(d1, { username: 'valido', password: '1234567' });

    expect(badUsername.status).toBe(400);
    expect((await badUsername.json()).error.code).toBe('invalid_username');
    expect(shortPassword.status).toBe(400);
    expect((await shortPassword.json()).error.code).toBe('invalid_password');
  });

  it('login correcto para Santi y Leandro devuelve capacidad de Budines sin secretos', async () => {
    const { d1, db } = createTestD1();

    const santi = await loginUser(d1, { username: 'SANTI', password: OWNER_TEST_PASSWORD });
    const leandro = await loginUser(d1, { username: 'leandro', password: OWNER_TEST_PASSWORD });
    const body = await leandro.clone().json();
    const bodyText = JSON.stringify(body);

    expect(santi.status).toBe(200);
    expect(leandro.status).toBe(200);
    expect(body.user).toMatchObject({
      displayName: 'Leandro',
      capabilities: {
        canAccessBudines: true
      }
    });
    expect(bodyText).not.toContain('password_hash');
    expect(bodyText).not.toContain('password_salt');
    expect(bodyText).not.toContain('token');
    expect(db.prepare('SELECT COUNT(*) AS count FROM app_users WHERE role = ?').get('owner').count).toBe(2);
  });

  it('usa el mismo mensaje genérico para contraseña incorrecta y usuario inexistente', async () => {
    const { d1 } = createTestD1();

    const wrongPassword = await loginUser(d1, { username: 'santi', password: 'wrong-password' });
    const missingUser = await loginUser(d1, { username: 'nadie', password: 'wrong-password' });
    const wrongBody = await wrongPassword.json();
    const missingBody = await missingUser.json();

    expect(wrongPassword.status).toBe(401);
    expect(missingUser.status).toBe(401);
    expect(wrongBody.error.message).toBe(missingBody.error.message);
  });

  it('actualiza un hash legado al formato vigente después de un login válido', async () => {
    const { d1, db } = createTestD1();
    const password = 'legacy-test-password';
    const saltHex = '7a'.repeat(32);
    const legacyHash = await deriveLegacyPasswordHash(
      globalThis.crypto,
      new TextEncoder().encode(password),
      saltHex,
      PASSWORD_ITERATIONS
    );
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
          password_kdf_version,
          role,
          can_access_budines,
          created_at,
          updated_at,
          disabled_at
        )
        VALUES (?, ?, ?, ?, ?, 'PBKDF2-HMAC-SHA-256', ?, 1, 'common', 0, ?, ?, NULL)
      `
    ).run('legacy-user', 'legacy-user', 'Legacy-User', legacyHash, saltHex, PASSWORD_ITERATIONS, now, now);

    const response = await loginUser(d1, { username: 'LEGACY-USER', password });
    const upgraded = db
      .prepare('SELECT password_hash, password_salt, password_kdf_version FROM app_users WHERE id = ?')
      .get('legacy-user');
    const expected = await derivePbkdf2PasswordHash(
      globalThis.crypto,
      new TextEncoder().encode(password),
      upgraded.password_salt,
      PASSWORD_ITERATIONS
    );

    expect(response.status).toBe(200);
    expect(upgraded.password_kdf_version).toBe(2);
    expect(upgraded.password_salt).not.toBe(saltHex);
    expect(upgraded.password_hash).toBe(expected);
  });

  it('sesión vencida, logout y token revocado dejan de autenticar', async () => {
    const { d1, db } = createTestD1();
    const loginResponse = await loginUser(d1, { username: 'santi', password: OWNER_TEST_PASSWORD });
    const cookie = loginResponse.headers.get('Set-Cookie');

    expect((await currentSessionBody(d1, cookie)).authenticated).toBe(true);

    db.prepare("UPDATE app_sessions SET created_at = '1999-01-01T00:00:00.000Z', expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await currentSessionBody(d1, cookie)).authenticated).toBe(false);

    const freshLogin = await loginUser(d1, { username: 'santi', password: OWNER_TEST_PASSWORD });
    const freshCookie = freshLogin.headers.get('Set-Cookie');
    const logoutResponse = await logoutUser(d1, freshCookie);

    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await currentSessionBody(d1, freshCookie)).authenticated).toBe(false);
  });

  it('sin sesión devuelve 401 y usuario común recibe 403 en operaciones Budines', async () => {
    const { d1 } = createTestD1();

    const noSession = await summaryEndpoint({
      request: new Request(`${ORIGIN}/api/summary`),
      env: { DB: d1 }
    });
    const ownerSummaryNoSession = await ownerSummaryEndpoint({
      request: new Request(`${ORIGIN}/api/owner-summary`),
      env: { DB: d1 }
    });
    expect(noSession.status).toBe(401);
    expect(ownerSummaryNoSession.status).toBe(401);
    await expect(requireSession({ request: new Request(`${ORIGIN}/api/session`), env: { DB: d1 } })).rejects.toMatchObject({
      status: 401
    });

    const registered = await register(d1, { username: 'comun403', password: COMMON_TEST_PASSWORD });
    const cookie = registered.headers.get('Set-Cookie');

    await expect(
      requireBudinesAccess({ request: request('/api/summary', { cookie }), env: { DB: d1 } })
    ).rejects.toMatchObject({
      status: 403
    });

    const summary = await summaryEndpoint({ request: request('/api/summary', { cookie }), env: { DB: d1 } });
    const ownerSummary = await ownerSummaryEndpoint({
      request: request('/api/owner-summary', { cookie }),
      env: { DB: d1 }
    });
    const list = await recordsEndpoint({ request: request('/api/records', { cookie }), env: { DB: d1 } });
    const create = await recordsEndpoint({
      request: request('/api/records', {
        method: 'POST',
        cookie,
        body: {
          username: 'santi',
          type: 'venta',
          quantity: '1',
          quantityUnit: 'NORM',
          amountArs: '1000',
          idempotencyKey: 'idem-common-direct-1'
        }
      }),
      env: { DB: d1 }
    });
    const voided = await voidEndpoint({
      request: request('/api/records/saldo-inicial-ars-3000/void', {
        method: 'POST',
        cookie,
        body: {
          username: 'santi',
          confirmation: 'ELIMINAR'
        }
      }),
      env: { DB: d1 },
      params: {
        id: 'saldo-inicial-ars-3000'
      }
    });

    expect(summary.status).toBe(403);
    expect(ownerSummary.status).toBe(403);
    expect(list.status).toBe(403);
    expect(create.status).toBe(403);
    expect(voided.status).toBe(403);
    expect(await summary.json()).toEqual({
      ok: false,
      error: {
        code: 'forbidden',
        message: 'No autorizado.'
      }
    });
    expect(await ownerSummary.json()).toEqual({
      ok: false,
      error: {
        code: 'forbidden',
        message: 'No autorizado.'
      }
    });
  });

  it('resume importes persistidos por usuario, excluye bajas y refleja cambios en D1', async () => {
    const { d1, db } = createTestD1();
    const santiLogin = await loginUser(d1, { username: 'SANTI', password: OWNER_TEST_PASSWORD });
    const leandroLogin = await loginUser(d1, { username: 'leandro', password: OWNER_TEST_PASSWORD });
    const santiCookie = santiLogin.headers.get('Set-Cookie');
    const leandroCookie = leandroLogin.headers.get('Set-Cookie');

    const initialForSanti = await ownerSummaryEndpoint({
      request: request('/api/owner-summary', { cookie: santiCookie }),
      env: { DB: d1 }
    });
    const initialForLeandro = await ownerSummaryEndpoint({
      request: request('/api/owner-summary', { cookie: leandroCookie }),
      env: { DB: d1 }
    });

    expect(initialForSanti.status).toBe(200);
    expect(initialForLeandro.status).toBe(200);
    expect(initialForSanti.headers.get('Cache-Control')).toBe('no-store');
    expect(await initialForSanti.json()).toEqual({
      ok: true,
      summary: {
        santiArs: 0,
        leandroArs: 0,
        totalArs: 0
      }
    });

    const santiCreated = await createSaleThroughApi(d1, santiCookie, '1000', 'idem-owner-summary-santi');
    const leandroCreated = await createSaleThroughApi(d1, leandroCookie, '2500', 'idem-owner-summary-leandro');
    const laterDeleted = await createSaleThroughApi(d1, santiCookie, '9000', 'idem-owner-summary-deleted');
    const deleted = await voidEndpoint({
      request: request(`/api/records/${laterDeleted.id}/void`, {
        method: 'POST',
        cookie: leandroCookie,
        body: { confirmation: 'ELIMINAR' }
      }),
      env: { DB: d1 },
      params: { id: laterDeleted.id }
    });

    expect(santiCreated.amountArs).toBe(1000);
    expect(leandroCreated.amountArs).toBe(2500);
    expect(deleted.status).toBe(200);

    const populated = await ownerSummaryEndpoint({
      request: request('/api/owner-summary', { cookie: santiCookie }),
      env: { DB: d1 }
    });
    expect(await populated.json()).toEqual({
      ok: true,
      summary: {
        santiArs: 1000,
        leandroArs: 2500,
        totalArs: 3500
      }
    });

    db.prepare('UPDATE operations SET amount_ars = ? WHERE id = ?').run(4000, santiCreated.id);

    const updated = await ownerSummaryEndpoint({
      request: request('/api/owner-summary', { cookie: leandroCookie }),
      env: { DB: d1 }
    });
    expect(await updated.json()).toEqual({
      ok: true,
      summary: {
        santiArs: 4000,
        leandroArs: 2500,
        totalArs: 6500
      }
    });
  });

  it('asocia el retiro al usuario de sesión e ignora identidad enviada por el cliente', async () => {
    const { d1, db } = createTestD1();
    const login = await loginUser(d1, { username: 'SANTI', password: OWNER_TEST_PASSWORD });
    const cookie = login.headers.get('Set-Cookie');

    const response = await recordsEndpoint({
      request: request('/api/records', {
        method: 'POST',
        cookie,
        body: {
          type: 'retiro',
          userId: 'leandro',
          amountArs: '108000',
          idempotencyKey: 'idem-session-retiro-1'
        }
      }),
      env: { DB: d1 }
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.record).toMatchObject({
      type: 'retiro',
      amountArs: 108000,
      quantity: null,
      quantityUnit: null,
      user: { id: 'santi', displayName: 'Santi' }
    });
    expect(db.prepare('SELECT user_id FROM operations WHERE id = ?').get(payload.record.id)).toEqual({
      user_id: 'santi'
    });
  });

  it('getCurrentSession lee app_sessions y actualiza last_seen_at', async () => {
    const { d1, db } = createTestD1();
    const loginResponse = await loginUser(d1, { username: 'santi', password: OWNER_TEST_PASSWORD });
    const cookie = loginResponse.headers.get('Set-Cookie');
    const before = db.prepare('SELECT last_seen_at FROM app_sessions').get().last_seen_at;
    await new Promise((resolve) => setTimeout(resolve, 5));

    const session = await getCurrentSession({ request: request('/api/session', { cookie }), env: { DB: d1 } });
    const after = db.prepare('SELECT last_seen_at FROM app_sessions').get().last_seen_at;

    expect(session.user).toMatchObject({
      id: 'santi',
      displayName: 'Santi',
      canAccessBudines: true
    });
    expect(after >= before).toBe(true);
  });
});

function createTestD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
  db.exec(readFileSync('migrations/0002_remove_incorrect_62000_record.sql', 'utf8'));
  db.exec(readFileSync('migrations/0003_password_auth.sql', 'utf8'));
  db.exec(readFileSync('migrations/0004_add_quantity_unit.sql', 'utf8'));
  db.exec(readFileSync('migrations/0005_track_password_kdf_version.sql', 'utf8'));
  db.exec(readFileSync('migrations/0007_add_operations.sql', 'utf8'));
  insertOwner(db, 'santi', 'Santi', ownerPasswordData.santi);
  insertOwner(db, 'leandro', 'Leandro', ownerPasswordData.leandro);
  dbs.push(db);
  return { db, d1: wrapD1(db) };
}

function insertOwner(db, id, displayName, passwordData) {
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
        password_kdf_version,
        role,
        can_access_budines,
        created_at,
        updated_at,
        disabled_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 2, 'owner', 1, ?, ?, NULL)
    `
  ).run(
    id,
    id,
    displayName,
    passwordData.hashHex,
    passwordData.saltHex,
    passwordData.algorithm,
    passwordData.iterations,
    new Date().toISOString(),
    new Date().toISOString()
  );
}

function wrapD1(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...bindings) {
          return {
            first: async () => statement.get(...bindings) || null,
            all: async () => ({ results: statement.all(...bindings) }),
            run: async () => statement.run(...bindings)
          };
        }
      };
    }
  };
}

function register(d1, body) {
  return registerEndpoint({
    request: request('/api/register', { method: 'POST', body }),
    env: { DB: d1 }
  });
}

function loginUser(d1, body) {
  return loginEndpoint({
    request: request('/api/login', { method: 'POST', body }),
    env: { DB: d1 }
  });
}

function logoutUser(d1, cookie) {
  return logoutEndpoint({
    request: request('/api/logout', { method: 'POST', cookie }),
    env: { DB: d1 }
  });
}

async function createSaleThroughApi(d1, cookie, amountArs, idempotencyKey) {
  const response = await recordsEndpoint({
    request: request('/api/records', {
      method: 'POST',
      cookie,
      body: {
        type: 'venta',
        quantity: '1',
        quantityUnit: 'NORM',
        amountArs,
        idempotencyKey
      }
    }),
    env: { DB: d1 }
  });
  expect(response.status).toBe(201);
  return (await response.json()).record;
}

async function currentSessionBody(d1, cookie) {
  const response = await sessionEndpoint({
    request: request('/api/session', { cookie }),
    env: { DB: d1 }
  });
  return response.json();
}

function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = new Headers({
    Accept: 'application/json'
  });
  if (method !== 'GET') {
    headers.set('Origin', ORIGIN);
  }
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (cookie) {
    headers.set('Cookie', cookie);
  }

  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
