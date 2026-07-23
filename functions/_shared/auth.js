import {
  AUTH_RATE_LIMIT_BLOCK_SECONDS,
  AUTH_RATE_LIMIT_WINDOW_SECONDS,
  DEFAULT_SESSION_DAYS,
  LOGIN_MAX_ATTEMPTS,
  MAX_SESSION_DAYS,
  PASSWORD_ALGORITHM,
  PASSWORD_HASH_BYTES,
  PASSWORD_ITERATIONS,
  PASSWORD_SALT_BYTES,
  REGISTER_MAX_ATTEMPTS,
  SESSION_COOKIE_NAME
} from './constants.js';
import { addDaysIso, nowIso } from './dates.js';
import { ApiError } from './http.js';
import { constantTimeEqualHex, randomHex, sha256Hex } from './crypto.js';
import { derivePbkdf2PasswordHash } from './password-kdf.js';

const encoder = new TextEncoder();
const DUMMY_SALT_HEX = '00'.repeat(PASSWORD_SALT_BYTES);
const DUMMY_HASH_HEX = '00'.repeat(PASSWORD_HASH_BYTES);

export async function hashPassword(password, { saltHex = randomHex(PASSWORD_SALT_BYTES), iterations = PASSWORD_ITERATIONS } = {}) {
  const hashHex = await derivePasswordHash(password, saltHex, iterations);
  return {
    algorithm: PASSWORD_ALGORITHM,
    iterations,
    saltHex,
    hashHex
  };
}

export async function verifyPassword(password, user) {
  if (
    !user ||
    user.password_algorithm !== PASSWORD_ALGORITHM ||
    !Number.isInteger(Number(user.password_iterations)) ||
    Number(user.password_iterations) < PASSWORD_ITERATIONS
  ) {
    await derivePasswordHash(password, DUMMY_SALT_HEX, PASSWORD_ITERATIONS);
    return false;
  }

  const hashHex = await derivePasswordHash(password, user.password_salt, Number(user.password_iterations));
  return constantTimeEqualHex(hashHex, user.password_hash);
}

export async function runDummyPasswordCheck(password) {
  const hashHex = await derivePasswordHash(password, DUMMY_SALT_HEX, PASSWORD_ITERATIONS);
  return constantTimeEqualHex(hashHex, DUMMY_HASH_HEX);
}

export async function createSession(db, env, userId, requestUrl, date = new Date()) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const createdAt = nowIso(date);
  const sessionDays = getSessionDays(env);
  const expiresAt = addDaysIso(date, sessionDays);
  const sessionId = crypto.randomUUID();

  await db
    .prepare(
      `
        INSERT INTO app_sessions (
          id,
          user_id,
          token_hash,
          created_at,
          expires_at,
          revoked_at,
          last_seen_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `
    )
    .bind(sessionId, userId, tokenHash, createdAt, expiresAt, createdAt)
    .run();

  return {
    token,
    expiresAt,
    cookie: buildSessionCookie(token, expiresAt, sessionDays)
  };
}

export async function getCurrentSession(context) {
  const token = getCookie(context.request.headers.get('Cookie'), SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const tokenHash = await sha256Hex(token);
  const now = nowIso();
  const row = await context.env.DB
    .prepare(
      `
        SELECT
          s.id AS session_id,
          s.user_id,
          s.expires_at,
          u.display_name,
          u.role,
          u.can_access_budines
        FROM app_sessions s
        INNER JOIN app_users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > ?
          AND u.disabled_at IS NULL
        LIMIT 1
      `
    )
    .bind(tokenHash, now)
    .first();

  if (!row) {
    return null;
  }

  await context.env.DB
    .prepare('UPDATE app_sessions SET last_seen_at = ? WHERE id = ?')
    .bind(now, row.session_id)
    .run();

  return {
    id: row.session_id,
    expiresAt: row.expires_at,
    user: {
      id: row.user_id,
      displayName: row.display_name,
      role: row.role,
      canAccessBudines: row.can_access_budines === 1
    },
    tokenHash
  };
}

export async function requireSession(context) {
  const session = await getCurrentSession(context);
  if (!session) {
    throw new ApiError(401, 'unauthorized', 'Necesitás iniciar sesión.');
  }
  return session;
}

export async function requireBudinesAccess(context) {
  const session = await requireSession(context);
  if (!session.user.canAccessBudines) {
    throw new ApiError(403, 'forbidden', 'No autorizado.');
  }
  return session;
}

export async function revokeCurrentSession(context) {
  const token = getCookie(context.request.headers.get('Cookie'), SESSION_COOKIE_NAME);
  if (!token) {
    return;
  }

  const tokenHash = await sha256Hex(token);
  await context.env.DB
    .prepare(
      `
        UPDATE app_sessions
        SET revoked_at = ?
        WHERE token_hash = ?
          AND revoked_at IS NULL
      `
    )
    .bind(nowIso(), tokenHash)
    .run();
}

export function clearSessionCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0'
  ].join('; ');
}

export function getSessionDays(env) {
  const raw = env?.SESSION_DURATION_DAYS;
  if (!raw) {
    return DEFAULT_SESSION_DAYS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_SESSION_DAYS) {
    return DEFAULT_SESSION_DAYS;
  }

  return parsed;
}

export function getClientKey(request, purpose, usernameNormalized = '') {
  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
  const userPart = usernameNormalized ? `:${usernameNormalized}` : '';
  return `${purpose}:${ip}${userPart}`;
}

export async function assertAuthRateLimit(db, key, { limit, now = new Date() } = {}) {
  const nowText = nowIso(now);
  const row = await db
    .prepare('SELECT attempts, window_started_at, blocked_until FROM auth_rate_limits WHERE key = ? LIMIT 1')
    .bind(key)
    .first();

  if (!row) {
    return;
  }

  if (row.blocked_until && row.blocked_until > nowText) {
    throw new ApiError(429, 'too_many_attempts', 'Demasiados intentos. Probá de nuevo más tarde.');
  }

  const windowStarted = Date.parse(row.window_started_at);
  if (Number.isFinite(windowStarted) && now.getTime() - windowStarted > AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000) {
    await clearAuthRateLimit(db, key);
    return;
  }

  if (Number(row.attempts) >= limit) {
    const blockedUntil = new Date(now.getTime() + AUTH_RATE_LIMIT_BLOCK_SECONDS * 1000).toISOString();
    await db
      .prepare('UPDATE auth_rate_limits SET blocked_until = ?, updated_at = ? WHERE key = ?')
      .bind(blockedUntil, nowText, key)
      .run();
    throw new ApiError(429, 'too_many_attempts', 'Demasiados intentos. Probá de nuevo más tarde.');
  }
}

export async function recordAuthFailure(db, key, purpose, { now = new Date() } = {}) {
  const nowText = nowIso(now);
  const row = await db
    .prepare('SELECT attempts, window_started_at FROM auth_rate_limits WHERE key = ? LIMIT 1')
    .bind(key)
    .first();

  if (!row) {
    await db
      .prepare(
        `
          INSERT INTO auth_rate_limits (
            key,
            purpose,
            attempts,
            window_started_at,
            blocked_until,
            updated_at
          )
          VALUES (?, ?, 1, ?, NULL, ?)
        `
      )
      .bind(key, purpose, nowText, nowText)
      .run();
    return;
  }

  const windowStarted = Date.parse(row.window_started_at);
  const attempts =
    !Number.isFinite(windowStarted) || now.getTime() - windowStarted > AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000
      ? 1
      : Number(row.attempts) + 1;
  const windowStartedAt = attempts === 1 ? nowText : row.window_started_at;

  await db
    .prepare(
      `
        UPDATE auth_rate_limits
        SET attempts = ?,
            window_started_at = ?,
            blocked_until = NULL,
            updated_at = ?
        WHERE key = ?
      `
    )
    .bind(attempts, windowStartedAt, nowText, key)
    .run();
}

export async function clearAuthRateLimit(db, key) {
  await db.prepare('DELETE FROM auth_rate_limits WHERE key = ?').bind(key).run();
}

export const AUTH_LIMITS = Object.freeze({
  login: LOGIN_MAX_ATTEMPTS,
  register: REGISTER_MAX_ATTEMPTS
});

async function derivePasswordHash(password, saltHex, iterations) {
  return derivePbkdf2PasswordHash(crypto, encoder.encode(password), saltHex, iterations);
}

function buildSessionCookie(token, expiresAt, sessionDays) {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
    `Max-Age=${sessionDays * 24 * 60 * 60}`
  ].join('; ');
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (rawName === name) {
      return rawValue.join('=');
    }
  }

  return null;
}
