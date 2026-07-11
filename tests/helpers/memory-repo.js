import { ApiError } from '../../functions/_shared/http.js';

export function createMemoryRepo({ investmentArs = 120000, records = defaultRecords() } = {}) {
  const store = records.map((record) => ({ ...record }));

  return {
    records: store,

    async getInitialInvestmentArs() {
      return investmentArs;
    },

    async getActiveTotalArs() {
      return store
        .filter((record) => record.status === 'activo')
        .reduce((sum, record) => sum + record.amountArs, 0);
    },

    async findRecordById(recordId) {
      return store.find((record) => record.id === recordId) || null;
    },

    async findRecordByIdempotencyKey(key) {
      return store.find((record) => record.idempotencyKey === key) || null;
    },

    async insertSale(record) {
      assertSaleRecord(record);
      if (store.some((existing) => existing.idempotencyKey === record.idempotencyKey)) {
        throw new Error('UNIQUE constraint failed: records.idempotency_key');
      }

      const withUser = {
        ...record,
        userDisplayName: record.userId === 'santi' ? 'Santi' : 'Leandro',
        voidedByDisplayName: null
      };
      store.push(withUser);
      return withUser;
    },

    async markRecordVoided(recordId, userId, voidedAt) {
      const record = store.find((entry) => entry.id === recordId);
      if (!record) {
        throw new ApiError(404, 'record_not_found', 'El registro no existe.');
      }

      if (record.type !== 'venta') {
        throw new ApiError(409, 'initial_balance_not_voidable', 'Un saldo inicial no se puede anular.');
      }

      if (record.status === 'activo') {
        record.status = 'anulado';
        record.voidedAt = voidedAt;
        record.voidedByUserId = userId;
        record.voidedByDisplayName = userId === 'santi' ? 'Santi' : 'Leandro';
      }

      return record;
    },

    async listRecords(limit, offset) {
      return store.slice(offset, offset + limit);
    }
  };
}

export function defaultRecords() {
  return [
    {
      id: 'saldo-inicial-ars-3000',
      type: 'saldo_inicial',
      userId: null,
      userDisplayName: null,
      grams: null,
      amountArs: 3000,
      status: 'activo',
      commercialDate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      voidedAt: null,
      voidedByUserId: null,
      voidedByDisplayName: null,
      idempotencyKey: null,
      source: 'seed'
    },
    {
      id: 'saldo-inicial-ars-62000',
      type: 'saldo_inicial',
      userId: null,
      userDisplayName: null,
      grams: null,
      amountArs: 62000,
      status: 'activo',
      commercialDate: null,
      createdAt: '2026-01-01T00:00:01.000Z',
      voidedAt: null,
      voidedByUserId: null,
      voidedByDisplayName: null,
      idempotencyKey: null,
      source: 'seed'
    }
  ];
}

function assertSaleRecord(record) {
  if (record.type !== 'venta') {
    throw new ApiError(400, 'invalid_record_type', 'El tipo de registro no es válido.');
  }

  if (!record.userId) {
    throw new ApiError(400, 'missing_user', 'La venta debe tener usuario.');
  }

  if (!Number.isSafeInteger(record.grams) || record.grams < 1) {
    throw new ApiError(400, 'missing_grams', 'La venta debe tener gramos.');
  }
}
