import { requireBudinesAccess } from '../../_shared/auth.js';
import { createD1Repository } from '../../_shared/d1-repository.js';
import {
  ApiError,
  assertDb,
  assertSameOrigin,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
  withApiErrorHandling
} from '../../_shared/http.js';
import { createSale, createWithdrawal } from '../../_shared/records-service.js';
import { serializeRecord } from '../../_shared/serializers.js';
import { parsePagination } from '../../_shared/validation.js';

export async function onRequest(context) {
  if (context.request.method === 'GET') {
    return handleGet(context);
  }

  if (context.request.method === 'POST') {
    return handlePost(context);
  }

  return methodNotAllowed(['GET', 'POST']);
}

function handleGet(context) {
  return withApiErrorHandling(async () => {
    await requireBudinesAccess(context);
    const url = new URL(context.request.url);
    const { limit, offset } = parsePagination(url.searchParams);
    const repo = createD1Repository(assertDb(context.env));
    const records = await repo.listRecords(limit + 1, offset);
    const visibleRecords = records.slice(0, limit);

    return jsonResponse({
      ok: true,
      records: visibleRecords.map(serializeRecord),
      pagination: {
        limit,
        offset,
        hasMore: records.length > limit,
        nextOffset: records.length > limit ? offset + limit : null
      }
    });
  });
}

function handlePost(context) {
  return withApiErrorHandling(async () => {
    assertSameOrigin(context.request);
    const session = await requireBudinesAccess(context);
    const body = await readJsonBody(context.request);
    const repo = createD1Repository(assertDb(context.env));
    const result = await createRecord(repo, body, session.user);

    return jsonResponse(
      {
        ok: true,
        result: result.kind,
        record: serializeRecord(result.record)
      },
      { status: result.kind === 'created' ? 201 : 200 }
    );
  });
}

function createRecord(repo, body, user) {
  if (body?.type === 'venta') {
    return createSale(repo, body, user);
  }
  if (body?.type === 'retiro') {
    return createWithdrawal(repo, body, user);
  }
  throw new ApiError(400, 'invalid_record_type', 'El tipo debe ser venta o retiro.');
}
