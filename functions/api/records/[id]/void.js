import { requireBudinesAccess } from '../../../_shared/auth.js';
import { createD1Repository } from '../../../_shared/d1-repository.js';
import {
  assertDb,
  assertSameOrigin,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
  withApiErrorHandling
} from '../../../_shared/http.js';
import { deleteRecord } from '../../../_shared/records-service.js';
import { serializeRecord } from '../../../_shared/serializers.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  return withApiErrorHandling(async () => {
    assertSameOrigin(context.request);
    const session = await requireBudinesAccess(context);
    const body = await readJsonBody(context.request);
    const repo = createD1Repository(assertDb(context.env));
    const result = await deleteRecord(repo, context.params.id, session.user, body.confirmation);

    return jsonResponse({
      ok: true,
      result: result.kind,
      record: serializeRecord(result.record)
    });
  });
}
