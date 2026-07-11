import {
  ALLOWED_USERS,
  DEFAULT_SESSION_DAYS,
  MAX_SESSION_DAYS,
  SESSION_COOKIE_NAME
} from './constants.js';
import { addDaysIso, nowIso } from './dates.js';
import { ApiError } from './http.js';
import { randomHex, secureCompareText, sha256Hex } from './crypto.js';

export async function verifyActivationCode(env, userId, activationCode) {
  const user = ALLOWED_USERS[userId];
  const expected = env?.[user?.activationSecretName];

  if (!user || !expected || isPlaceholderSecret(expected)) {
    throw new ApiError(503, 'activation_not_configured', 'La activación no está configurada.');
  }

  if (typeof activationCode !== 'string' || activationCode.length < 1 || activationCode.length > 256) {
    throw new ApiError(401, 'invalid_credentials', 'Credenciales inválidas.');
  }

  const matches = await secureCompareText(activationCode, expected);
  if (!matches) {
    throw new ApiError(401, 'invalid_credentials', 'Credenciales inválidas.');
  }
}

export async function createSession(db, env, userId, requestUrl, date = new Date()) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const createdAt = nowIso(date);
  const expiresAt = addDaysIso(date, getSessionDays(env));
  const sessionId = crypto.randomUUID();

  await db
    .prepare(
      `
        INSERT INTO sessions (
          id,
          user_id,
          token_hash,
          created_at,
          expires_at,
          revoked_at,
          last_used_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `
    )
    .bind(sessionId, userId, tokenHash, createdAt, expiresAt, createdAt)
    .run();

  return {
    token,
    expiresAt,
    cookie: buildSessionCookie(token, expiresAt, requestUrl)
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
          u.display_name
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > ?
          AND u.active = 1
        LIMIT 1
      `
    )
    .bind(tokenHash, now)
    .first();

  if (!row) {
    return null;
  }

  await context.env.DB
    .prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?')
    .bind(now, row.session_id)
    .run();

  return {
    id: row.session_id,
    expiresAt: row.expires_at,
    user: {
      id: row.user_id,
      displayName: row.display_name
    },
    tokenHash
  };
}

export async function requireSession(context) {
  const session = await getCurrentSession(context);
  if (!session) {
    throw new ApiError(401, 'unauthorized', 'Necesitás activar la sesión.');
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
        UPDATE sessions
        SET revoked_at = ?
        WHERE token_hash = ?
          AND revoked_at IS NULL
      `
    )
    .bind(nowIso(), tokenHash)
    .run();
}

export function clearSessionCookie(requestUrl) {
  const secure = shouldUseSecureCookie(requestUrl);
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
    'Max-Age=0'
  ]
    .filter(Boolean)
    .join('; ');
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

function buildSessionCookie(token, expiresAt, requestUrl) {
  const secure = shouldUseSecureCookie(requestUrl);
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
    `Expires=${new Date(expiresAt).toUTCString()}`
  ]
    .filter(Boolean)
    .join('; ');
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

function shouldUseSecureCookie(requestUrl) {
  return new URL(requestUrl).protocol === 'https:';
}

function isPlaceholderSecret(secret) {
  return String(secret).startsWith('CAMBIAR_') || String(secret).startsWith('REEMPLAZAR_');
}
