import { jsonResponse, methodNotAllowed } from '../_shared/http.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  return jsonResponse(
    {
      ok: false,
      error: {
        code: 'activation_removed',
        message: 'La activación fue reemplazada por inicio de sesión.'
      }
    },
    { status: 410 }
  );
}
