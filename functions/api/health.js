import { APP_NAME } from '../_shared/constants.js';
import { jsonResponse, methodNotAllowed, withApiErrorHandling } from '../_shared/http.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return methodNotAllowed(['GET']);
  }

  return withApiErrorHandling(async () =>
    jsonResponse({
      ok: true,
      app: APP_NAME,
      status: 'ok',
      time: new Date().toISOString()
    })
  );
}
