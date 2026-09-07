import { requireSession } from '../_shared/auth.js';
import { ApiError, assertDb, assertSameOrigin, jsonResponse, methodNotAllowed, readJsonBody, withApiErrorHandling } from '../_shared/http.js';

const SELECT_MESSAGES = `SELECT m.id, m.user_id AS userId, u.display_name AS username,
  m.content, m.created_at AS createdAt FROM chat_messages m
  INNER JOIN app_users u ON u.id = m.user_id`;

export async function onRequest(context) {
  const method = context.request.method;
  if (!['GET', 'POST'].includes(method)) return methodNotAllowed(['GET', 'POST']);
  return withApiErrorHandling(async () => {
    assertSameOrigin(context.request);
    const db = assertDb(context.env);
    const session = await requireSession(context);
    if (method === 'GET') {
      const after = Number(new URL(context.request.url).searchParams.get('after') || 0);
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new ApiError(400, 'invalid_cursor', 'Cursor inválido.');
      }
      const { results } = await db.prepare(`${SELECT_MESSAGES} WHERE m.id > ? ORDER BY m.id ASC LIMIT 101`).bind(after).all();
      return jsonResponse({ ok: true, messages: results.slice(0, 100), hasMore: results.length > 100 });
    }

    const body = await readJsonBody(context.request);
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content || content.length > 2000 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId || '')) {
      throw new ApiError(400, 'invalid_message', 'Escribí un mensaje de hasta 2000 caracteres.');
    }
    // Identity and timestamp are exclusively server-owned. The key makes retries safe.
    await db.prepare(`INSERT INTO chat_messages (user_id, content, request_id) VALUES (?, ?, ?)
      ON CONFLICT(user_id, request_id) DO NOTHING`).bind(session.user.id, content, body.requestId).run();
    const message = await db.prepare(`${SELECT_MESSAGES} WHERE m.user_id = ? AND m.request_id = ?`)
      .bind(session.user.id, body.requestId).first();
    if (message.content !== content) throw new ApiError(409, 'message_conflict', 'Ese envío ya contiene otro mensaje.');
    return jsonResponse({ ok: true, message });
  });
}
