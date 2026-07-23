import { requireBudinesAccess } from '../_shared/auth.js';
import { createD1Repository } from '../_shared/d1-repository.js';
import { assertDb, jsonResponse, methodNotAllowed, withApiErrorHandling } from '../_shared/http.js';
import { getSummary } from '../_shared/summary.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return methodNotAllowed(['GET']);
  }

  return withApiErrorHandling(async () => {
    await requireBudinesAccess(context);
    const repo = createD1Repository(assertDb(context.env));
    const summary = await getSummary(repo);

    return jsonResponse({
      ok: true,
      summary
    });
  });
}
