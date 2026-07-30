import { COMMON_ROLE } from '../_shared/constants.js';
import {
  AUTH_LIMITS,
  assertAuthRateLimit,
  clearAuthRateLimit,
  createSession,
  getClientKey,
  hashPassword,
  recordAuthFailure
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
import { validateNewPassword, validateRegistrationUsername } from '../_shared/validation.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  return withApiErrorHandling(async () => {
    assertSameOrigin(context.request);
    const db = assertDb(context.env);
    const rateLimitKey = getClientKey(context.request, 'register');
    await assertAuthRateLimit(db, rateLimitKey, { limit: AUTH_LIMITS.register });

    try {
      const body = await readJsonBody(context.request);
      const { usernameNormalized, displayName } = validateRegistrationUsername(body.username);
      const password = validateNewPassword(body.password);
      const passwordData = await hashPassword(password);
      const user = {
        id: crypto.randomUUID(),
        usernameNormalized,
        displayName,
        role: COMMON_ROLE,
        canAccessBudines: false
      };
      const now = new Date().toISOString();

      await db
        .prepare(
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
            VALUES (?, ?, ?, ?, ?, ?, ?, 2, ?, 0, ?, ?, NULL)
          `
        )
        .bind(
          user.id,
          user.usernameNormalized,
          user.displayName,
          passwordData.hashHex,
          passwordData.saltHex,
          passwordData.algorithm,
          passwordData.iterations,
          COMMON_ROLE,
          now,
          now
        )
        .run();

      await clearAuthRateLimit(db, rateLimitKey);
      const session = await createSession(db, context.env, user.id, context.request.url);

      return jsonResponse(
        {
          ok: true,
          user: serializeUser(user),
          expiresAt: session.expiresAt
        },
        {
          status: 201,
          headers: {
            'Set-Cookie': session.cookie
          }
        }
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        await recordAuthFailure(db, rateLimitKey, 'register');
        throw new ApiError(409, 'username_unavailable', 'Ese nombre de usuario no está disponible.');
      }
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        await recordAuthFailure(db, rateLimitKey, 'register');
      }
      throw error;
    }
  });
}

function isUniqueConstraintError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('unique') || message.includes('constraint');
}
