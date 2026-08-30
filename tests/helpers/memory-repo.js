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
        .filter((record) => record.type !== 'retiro' && record.status === 'activo' && !record.deletedAt)
        .reduce((sum, record) => sum + record.amountArs, 0);
    },

    async getActiveWithdrawalTotalArs() {
      return store
        .filter((record) => record.type === 'retiro' && record.status === 'activo' && !record.deletedAt)
        .reduce((sum, record) => sum + record.amountArs, 0);
    },

    async getActiveOwnerTotalsArs() {
      const activeOperations = store.filter(
        (record) =>
          (record.type === 'venta' || record.type === 'retiro') &&
          record.status === 'activo' &&
          !record.deletedAt
      );
      return {
        santiArs: activeOperations
          .filter((record) => record.userId === 'santi')
          .reduce((sum, record) => sum + signedAmount(record), 0),
        leandroArs: activeOperations
          .filter((record) => record.userId === 'leandro')
          .reduce((sum, record) => sum + signedAmount(record), 0)
      };
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
        voidedByDisplayName: null,
        deletedAt: null,
        deletedByUserId: null,
        deletedByDisplayName: null,
        isDeleted: false
      };
      store.push(withUser);
      return withUser;
    },

    async insertWithdrawal(record) {
      assertWithdrawalRecord(record);
      if (store.some((existing) => existing.idempotencyKey === record.idempotencyKey)) {
        throw new Error('UNIQUE constraint failed: operations.idempotency_key');
      }

      const withUser = withRecordMetadata(record);
      store.push(withUser);
      return withUser;
    },

    async markRecordDeleted(recordId, userId, deletedAt) {
      const record = store.find((entry) => entry.id === recordId);
      if (!record) {
        throw new ApiError(404, 'record_not_found', 'El registro no existe.');
      }

      if (record.status !== 'activo' || record.deletedAt) {
        return record;
      }

      if (record.type === 'venta' || record.type === 'retiro') {
        record.status = 'anulado';
        record.voidedAt = deletedAt;
        record.voidedByUserId = userId;
        record.voidedByDisplayName = userId === 'santi' ? 'Santi' : 'Leandro';
      }

      record.deletedAt = deletedAt;
      record.deletedByUserId = userId;
      record.deletedByDisplayName = userId === 'santi' ? 'Santi' : 'Leandro';
      record.deletionReason = 'user_deleted';
      record.isDeleted = true;
      return record;
    },

    async listRecords(limit, offset) {
      return store
        .filter((record) => record.status === 'activo' && !record.deletedAt)
        .slice(offset, offset + limit);
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
      quantity: null,
      quantityUnit: 'GR',
      amountArs: 3000,
      status: 'activo',
      commercialDate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      voidedAt: null,
      voidedByUserId: null,
      voidedByDisplayName: null,
      idempotencyKey: null,
      source: 'seed',
      deletedAt: null,
      deletedByUserId: null,
      deletedByDisplayName: null,
      deletionReason: null,
      isDeleted: false
    },
    {
      id: 'saldo-inicial-ars-62000',
      type: 'saldo_inicial',
      userId: null,
      userDisplayName: null,
      quantity: null,
      quantityUnit: 'GR',
      amountArs: 62000,
      status: 'activo',
      commercialDate: null,
      createdAt: '2026-01-01T00:00:01.000Z',
      voidedAt: null,
      voidedByUserId: null,
      voidedByDisplayName: null,
      idempotencyKey: null,
      source: 'seed',
      deletedAt: '2026-07-12T00:00:00.000Z',
      deletedByUserId: null,
      deletedByDisplayName: null,
      deletionReason: 'incorrect_initial_balance',
      isDeleted: true
    }
  ];
}

export function saleRecord(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    type: 'venta',
    userId: 'santi',
    userDisplayName: 'Santi',
    quantity: 10,
    quantityUnit: 'NORM',
    amountArs: 1000,
    status: 'activo',
    commercialDate: '2026-07-12',
    createdAt: '2026-07-12T15:00:00.000Z',
    voidedAt: null,
    voidedByUserId: null,
    voidedByDisplayName: null,
    idempotencyKey: `idem-${crypto.randomUUID()}`,
    source: 'web',
    deletedAt: null,
    deletedByUserId: null,
    deletedByDisplayName: null,
    deletionReason: null,
    isDeleted: false,
    ...overrides
  };
}

export function withdrawalRecord(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    type: 'retiro',
    userId: 'santi',
    userDisplayName: 'Santi',
    quantity: null,
    quantityUnit: null,
    amountArs: 1000,
    status: 'activo',
    commercialDate: '2026-07-12',
    createdAt: '2026-07-12T15:00:00.000Z',
    voidedAt: null,
    voidedByUserId: null,
    voidedByDisplayName: null,
    idempotencyKey: `idem-${crypto.randomUUID()}`,
    source: 'web',
    deletedAt: null,
    deletedByUserId: null,
    deletedByDisplayName: null,
    deletionReason: null,
    isDeleted: false,
    ...overrides
  };
}

function assertSaleRecord(record) {
  if (record.type !== 'venta') {
    throw new ApiError(400, 'invalid_record_type', 'El tipo de registro no es valido.');
  }

  if (!record.userId) {
    throw new ApiError(400, 'missing_user', 'La venta debe tener usuario.');
  }

  if (!Number.isSafeInteger(record.quantity) || record.quantity < 1) {
    throw new ApiError(400, 'missing_quantity', 'La venta debe tener cantidad.');
  }

  if (record.quantityUnit !== 'NORM' && record.quantityUnit !== 'GEN') {
    throw new ApiError(400, 'invalid_quantity_unit', 'El tipo debe ser NORM o GEN.');
  }
}

function assertWithdrawalRecord(record) {
  if (record.type !== 'retiro' || record.quantity !== null || record.quantityUnit !== null) {
    throw new ApiError(400, 'invalid_record_type', 'El retiro no debe tener cantidad ni tipo de venta.');
  }
  if (!record.userId) {
    throw new ApiError(400, 'missing_user', 'El retiro debe tener usuario.');
  }
}

function withRecordMetadata(record) {
  return {
    ...record,
    userDisplayName: record.userId === 'santi' ? 'Santi' : 'Leandro',
    voidedByDisplayName: null,
    deletedAt: null,
    deletedByUserId: null,
    deletedByDisplayName: null,
    isDeleted: false
  };
}

function signedAmount(record) {
  return record.type === 'retiro' ? -record.amountArs : record.amountArs;
}
