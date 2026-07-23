import { clearSessionCookie, revokeCurrentSession } from '../_shared/auth.js';
import { assertDb, assertSameOrigin, jsonResponse, methodNotAllowed, withApiErrorHandling } from '../_shared/http.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  return withApiErrorHandling(async () => {
    assertSameOrigin(context.request);
    assertDb(context.env);
    await revokeCurrentSession(context);

    return jsonResponse(
      {
        ok: true
      },
      {
        headers: {
          'Set-Cookie': clearSessionCookie()
        }
      }
    );
  });
}
