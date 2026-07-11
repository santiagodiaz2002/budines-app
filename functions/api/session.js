import { getCurrentSession } from '../_shared/auth.js';
import { assertDb, jsonResponse, methodNotAllowed, withApiErrorHandling } from '../_shared/http.js';
import { serializeUser } from '../_shared/serializers.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return methodNotAllowed(['GET']);
  }

  return withApiErrorHandling(async () => {
    assertDb(context.env);
    const session = await getCurrentSession(context);

    if (!session) {
      return jsonResponse({
        ok: true,
        authenticated: false
      });
    }

    return jsonResponse({
      ok: true,
      authenticated: true,
      user: serializeUser(session.user),
      expiresAt: session.expiresAt
    });
  });
}
