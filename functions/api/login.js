import {
  AUTH_LIMITS,
  assertAuthRateLimit,
  clearAuthRateLimit,
  createSession,
  getClientKey,
  recordAuthFailure,
  runDummyPasswordCheck,
  verifyPassword
} from '../_shared/auth.js';
import {
  assertDb,
  assertSameOrigin,
  ApiError,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
  withApiErrorHandling
} from '../_shared/http.js';
import { serializeUser } from '../_shared/serializers.js';
import { validateLoginPassword, validateLoginUsername } from '../_shared/validation.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  return withApiErrorHandling(async () => {
    assertSameOrigin(context.request);
    const db = assertDb(context.env);
    const body = await readJsonBody(context.request);
    const usernameNormalized = validateLoginUsername(body.username);
    const password = validateLoginPassword(body.password);
    const rateLimitKey = getClientKey(context.request, 'login', usernameNormalized);

    await assertAuthRateLimit(db, rateLimitKey, { limit: AUTH_LIMITS.login });

    try {
      const user = await findUserByUsername(db, usernameNormalized);
      const valid = user ? await verifyPassword(password, user) : await runDummyPasswordCheck(password);
      if (!valid || user.disabled_at) {
        throwInvalidCredentials();
      }

      await clearAuthRateLimit(db, rateLimitKey);
      const session = await createSession(db, context.env, user.id, context.request.url);

      return jsonResponse(
        {
          ok: true,
          user: serializeUser(mapUser(user)),
          expiresAt: session.expiresAt
        },
        {
          headers: {
            'Set-Cookie': session.cookie
          }
        }
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_credentials') {
        await recordAuthFailure(db, rateLimitKey, 'login');
      }
      throw error;
    }
  });
}

async function findUserByUsername(db, usernameNormalized) {
  return db
    .prepare(
      `
        SELECT
          id,
          username_normalized,
          display_name,
          password_hash,
          password_salt,
          password_algorithm,
          password_iterations,
          role,
          can_access_budines,
          disabled_at
        FROM app_users
        WHERE username_normalized = ?
        LIMIT 1
      `
    )
    .bind(usernameNormalized)
    .first();
}

function mapUser(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    canAccessBudines: row.can_access_budines === 1
  };
}

function throwInvalidCredentials() {
  throw new ApiError(401, 'invalid_credentials', 'Nombre de usuario o contraseña incorrectos.');
}
