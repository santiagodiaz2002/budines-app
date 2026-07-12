import { ApiError } from './http.js';
import { argentinaBusinessDate, nowIso } from './dates.js';
import { parsePositiveIntegerText, validateIdempotencyKey } from './validation.js';

export async function createSale(repo, input, user, date = new Date()) {
  const grams = parsePositiveIntegerText(input?.grams, 'Gramos');
  const amountArs = parsePositiveIntegerText(input?.amountArs, 'Importe total');
  const idempotencyKey = validateIdempotencyKey(input?.idempotencyKey);

  const existing = await repo.findRecordByIdempotencyKey(idempotencyKey);
  if (existing) {
    assertSameSale(existing, { userId: user.id, grams, amountArs });
    return { kind: 'existing', record: existing };
  }

  const record = {
    id: crypto.randomUUID(),
    type: 'venta',
    userId: user.id,
    grams,
    amountArs,
    status: 'activo',
    commercialDate: argentinaBusinessDate(date),
    createdAt: nowIso(date),
    voidedAt: null,
    voidedByUserId: null,
    idempotencyKey,
    source: 'web'
  };

  try {
    const inserted = await repo.insertSale(record);
    return { kind: 'created', record: inserted };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const duplicate = await repo.findRecordByIdempotencyKey(idempotencyKey);
    if (!duplicate) {
      throw error;
    }

    assertSameSale(duplicate, { userId: user.id, grams, amountArs });
    return { kind: 'existing', record: duplicate };
  }
}

export async function deleteRecord(repo, recordId, user, confirmation, date = new Date()) {
  if (typeof recordId !== 'string' || recordId.length < 1 || recordId.length > 120) {
    throw new ApiError(400, 'invalid_record_id', 'El registro solicitado no es valido.');
  }

  if (!/^[A-Za-z0-9:_-]+$/.test(recordId)) {
    throw new ApiError(400, 'invalid_record_id', 'El registro solicitado no es valido.');
  }

  if (confirmation !== 'ELIMINAR') {
    throw new ApiError(400, 'invalid_confirmation', 'Para eliminar escribi ELIMINAR.');
  }

  const record = await repo.findRecordById(recordId);
  if (!record) {
    throw new ApiError(404, 'record_not_found', 'El registro no existe.');
  }

  if (record.status !== 'activo' || record.isDeleted) {
    return { kind: 'already_deleted', record };
  }

  const updated = await repo.markRecordDeleted(recordId, user.id, nowIso(date));
  return { kind: 'deleted', record: updated };
}

function assertSameSale(record, expected) {
  const same =
    record.type === 'venta' &&
    record.userId === expected.userId &&
    record.grams === expected.grams &&
    record.amountArs === expected.amountArs;

  if (!same) {
    throw new ApiError(409, 'idempotency_conflict', 'La clave de idempotencia ya fue usada para otra operacion.');
  }
}

function isUniqueConstraintError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('unique') || message.includes('constraint');
}
