import { createSession, verifyActivationCode } from '../_shared/auth.js';
import { ALLOWED_USERS } from '../_shared/constants.js';
import {
  assertDb,
  ApiError,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
  withApiErrorHandling
} from '../_shared/http.js';
import { serializeUser } from '../_shared/serializers.js';
import { resolveActivationUserId } from '../_shared/validation.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  return withApiErrorHandling(async () => {
    const db = assertDb(context.env);
    const body = await readJsonBody(context.request);
    const userId = resolveActivationUserId(body.userName);

    await ensureActiveUser(db, userId);
    await verifyActivationCode(context.env, userId, body.activationCode);

    const session = await createSession(db, context.env, userId, context.request.url);
    const user = ALLOWED_USERS[userId];

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
  });
}

async function ensureActiveUser(db, userId) {
  const row = await db
    .prepare('SELECT id, active FROM users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first();

  if (!row || row.active !== 1) {
    throw new ApiError(401, 'invalid_credentials', 'Credenciales inválidas.');
  }
}
