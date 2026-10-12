import { requireSession } from '../_shared/auth.js';
import { assertDb, assertSameOrigin, jsonResponse, methodNotAllowed, readJsonBody, withApiErrorHandling } from '../_shared/http.js';
import { listSongbook, mutateSongbook } from '../_shared/songbook.js';

export async function onRequest(context) {
  const method = context.request.method;
  if (!['GET', 'POST'].includes(method)) return methodNotAllowed(['GET', 'POST']);
  return withApiErrorHandling(async () => {
    assertSameOrigin(context.request);
    const db = assertDb(context.env);
    await requireSession(context);
    const result = method === 'GET'
      ? await listSongbook(db)
      : await mutateSongbook(db, await readJsonBody(context.request, 65536));
    return jsonResponse({ ok: true, ...result });
  });
}
