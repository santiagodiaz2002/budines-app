import { clearSessionCookie, revokeCurrentSession } from '../_shared/auth.js';
import { assertDb, jsonResponse, methodNotAllowed, withApiErrorHandling } from '../_shared/http.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  return withApiErrorHandling(async () => {
    assertDb(context.env);
    await revokeCurrentSession(context);

    return jsonResponse(
      {
        ok: true
      },
      {
        headers: {
          'Set-Cookie': clearSessionCookie(context.request.url)
        }
      }
    );
  });
}
