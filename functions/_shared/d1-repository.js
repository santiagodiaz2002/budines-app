import { ALLOWED_USERS } from './constants.js';
import { ApiError } from './http.js';

export function createD1Repository(db) {
  return {
    async getInitialInvestmentArs() {
      const row = await db.prepare("SELECT value FROM config WHERE key = 'initial_investment_ars'").first();
      const value = Number(row?.value);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new ApiError(500, 'missing_investment', 'La inversión inicial no está configurada.');
      }
      return value;
    },

    async getActiveTotalArs() {
      const row = await db.prepare(`
        SELECT COALESCE(SUM(amount_ars), 0) AS total_ars
        FROM (
          SELECT r.amount_ars
          FROM records r
          LEFT JOIN record_deletions rd ON rd.record_id = r.id
          WHERE r.status = 'activo' AND rd.record_id IS NULL
          UNION ALL
          SELECT o.amount_ars
          FROM operations o
          WHERE o.type = 'venta' AND o.status = 'activo'
        ) active_income
      `).first();
      return parseNonNegativeTotal(row?.total_ars, 'El total acumulado no es válido.');
    },

    async getActiveWithdrawalTotalArs() {
      const row = await db.prepare(`
        SELECT COALESCE(SUM(amount_ars), 0) AS total_ars
        FROM operations
        WHERE type = 'retiro' AND status = 'activo'
      `).first();
      return parseNonNegativeTotal(row?.total_ars, 'El total de retiros no es válido.');
    },

    async getActiveOwnerTotalsArs() {
      const santiId = ALLOWED_USERS.santi.id;
      const leandroId = ALLOWED_USERS.leandro.id;
      const row = await db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN user_id = ? THEN signed_amount_ars ELSE 0 END), 0) AS santi_ars,
          COALESCE(SUM(CASE WHEN user_id = ? THEN signed_amount_ars ELSE 0 END), 0) AS leandro_ars
        FROM (
          SELECT r.user_id, r.amount_ars AS signed_amount_ars
          FROM records r
          LEFT JOIN record_deletions rd ON rd.record_id = r.id
          WHERE r.type = 'venta'
            AND r.status = 'activo'
            AND rd.record_id IS NULL
            AND r.user_id IN (?, ?)
          UNION ALL
          SELECT
            o.user_id,
            CASE WHEN o.type = 'retiro' THEN -o.amount_ars ELSE o.amount_ars END AS signed_amount_ars
          FROM operations o
          WHERE o.status = 'activo' AND o.user_id IN (?, ?)
        ) owner_operations
      `).bind(santiId, leandroId, santiId, leandroId, santiId, leandroId).first();
      return {
        santiArs: Number(row?.santi_ars),
        leandroArs: Number(row?.leandro_ars)
      };
    },

    async findRecordById(recordId) {
      const operation = await operationSelect(db, 'o.id = ?', [recordId]);
      if (operation) return mapRecord(operation);
      const legacy = await legacyRecordSelect(db, 'r.id = ?', [recordId]);
      return legacy ? mapRecord(legacy) : null;
    },

    async findRecordByIdempotencyKey(idempotencyKey) {
      const operation = await operationSelect(db, 'o.idempotency_key = ?', [idempotencyKey]);
      if (operation) return mapRecord(operation);
      const legacy = await legacyRecordSelect(db, 'r.idempotency_key = ?', [idempotencyKey]);
      return legacy ? mapRecord(legacy) : null;
    },

    async insertSale(record) {
      return insertOperation(db, this, record);
    },

    async insertWithdrawal(record) {
      return insertOperation(db, this, record);
    },

    async markRecordDeleted(recordId, userId, deletedAt) {
      const record = await this.findRecordById(recordId);
      if (!record) throw new ApiError(404, 'record_not_found', 'El registro no existe.');
      if (record.status !== 'activo' || record.deletedAt) return record;

      if (record.storage === 'operations') {
        await db.prepare(`
          UPDATE operations
          SET status = 'anulado', voided_at = ?, voided_by_user_id = ?
          WHERE id = ? AND status = 'activo'
        `).bind(deletedAt, userId, recordId).run();
      } else {
        if (record.type === 'venta') {
          await db.prepare(`
            UPDATE records
            SET status = 'anulado', voided_at = ?, voided_by_user_id = ?
            WHERE id = ? AND type = 'venta' AND status = 'activo'
          `).bind(deletedAt, userId, recordId).run();
        }
        await db.prepare(`
          INSERT OR IGNORE INTO record_deletions (record_id, deleted_at, deleted_by_user_id, reason)
          VALUES (?, ?, ?, 'user_deleted')
        `).bind(recordId, deletedAt, userId).run();
      }

      const updated = await this.findRecordById(recordId);
      if (!updated) throw new ApiError(404, 'record_not_found', 'El registro no existe.');
      return updated;
    },

    async listRecords(limit, offset) {
      const result = await db.prepare(`
        SELECT *
        FROM (
          SELECT
            r.id, r.type, r.user_id, u.display_name AS user_display_name,
            r.grams AS quantity, COALESCE(r.quantity_unit, 'GR') AS quantity_unit,
            r.amount_ars, r.status, r.commercial_date, r.created_at,
            r.voided_at, r.voided_by_user_id, vu.display_name AS voided_by_display_name,
            r.idempotency_key, r.source, NULL AS deleted_at,
            NULL AS deleted_by_user_id, NULL AS deleted_by_display_name,
            NULL AS deletion_reason, 'records' AS storage
          FROM records r
          LEFT JOIN users u ON u.id = r.user_id
          LEFT JOIN users vu ON vu.id = r.voided_by_user_id
          LEFT JOIN record_deletions rd ON rd.record_id = r.id
          WHERE r.status = 'activo' AND rd.record_id IS NULL
          UNION ALL
          SELECT
            o.id, o.type, o.user_id, u.display_name AS user_display_name,
            o.quantity, o.quantity_unit, o.amount_ars, o.status,
            o.commercial_date, o.created_at, o.voided_at, o.voided_by_user_id,
            vu.display_name AS voided_by_display_name, o.idempotency_key, o.source,
            NULL AS deleted_at, NULL AS deleted_by_user_id,
            NULL AS deleted_by_display_name, NULL AS deletion_reason,
            'operations' AS storage
          FROM operations o
          LEFT JOIN users u ON u.id = o.user_id
          LEFT JOIN users vu ON vu.id = o.voided_by_user_id
          WHERE o.status = 'activo'
        ) active_records
        ORDER BY
          COALESCE(commercial_date, substr(created_at, 1, 10)) DESC,
          created_at DESC,
          id DESC
        LIMIT ? OFFSET ?
      `).bind(limit, offset).all();
      return result.results.map(mapRecord);
    }
  };
}

async function insertOperation(db, repo, record) {
  await db.prepare(`
    INSERT INTO operations (
      id, type, user_id, quantity, quantity_unit, amount_ars, status,
      commercial_date, created_at, voided_at, voided_by_user_id,
      idempotency_key, source
    )
    VALUES (?, ?, ?, ?, ?, ?, 'activo', ?, ?, NULL, NULL, ?, 'web')
  `).bind(
    record.id,
    record.type,
    record.userId,
    record.quantity,
    record.quantityUnit,
    record.amountArs,
    record.commercialDate,
    record.createdAt,
    record.idempotencyKey
  ).run();
  return repo.findRecordById(record.id);
}

async function legacyRecordSelect(db, whereClause, bindings) {
  return db.prepare(`
    SELECT
      r.id, r.type, r.user_id, u.display_name AS user_display_name,
      r.grams AS quantity, COALESCE(r.quantity_unit, 'GR') AS quantity_unit,
      r.amount_ars, r.status, r.commercial_date, r.created_at,
      r.voided_at, r.voided_by_user_id, vu.display_name AS voided_by_display_name,
      r.idempotency_key, r.source, rd.deleted_at, rd.deleted_by_user_id,
      du.display_name AS deleted_by_display_name, rd.reason AS deletion_reason,
      'records' AS storage
    FROM records r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN users vu ON vu.id = r.voided_by_user_id
    LEFT JOIN record_deletions rd ON rd.record_id = r.id
    LEFT JOIN users du ON du.id = rd.deleted_by_user_id
    WHERE ${whereClause}
    LIMIT 1
  `).bind(...bindings).first();
}

async function operationSelect(db, whereClause, bindings) {
  return db.prepare(`
    SELECT
      o.id, o.type, o.user_id, u.display_name AS user_display_name,
      o.quantity, o.quantity_unit, o.amount_ars, o.status,
      o.commercial_date, o.created_at, o.voided_at, o.voided_by_user_id,
      vu.display_name AS voided_by_display_name, o.idempotency_key, o.source,
      o.voided_at AS deleted_at, o.voided_by_user_id AS deleted_by_user_id,
      vu.display_name AS deleted_by_display_name,
      CASE WHEN o.status = 'anulado' THEN 'user_deleted' ELSE NULL END AS deletion_reason,
      'operations' AS storage
    FROM operations o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN users vu ON vu.id = o.voided_by_user_id
    WHERE ${whereClause}
    LIMIT 1
  `).bind(...bindings).first();
}

function mapRecord(row) {
  return {
    id: row.id,
    type: row.type,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
    quantityUnit: row.quantity_unit || null,
    amountArs: Number(row.amount_ars),
    status: row.status,
    commercialDate: row.commercial_date,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidedByUserId: row.voided_by_user_id,
    voidedByDisplayName: row.voided_by_display_name,
    idempotencyKey: row.idempotency_key,
    source: row.source,
    deletedAt: row.deleted_at,
    deletedByUserId: row.deleted_by_user_id,
    deletedByDisplayName: row.deleted_by_display_name,
    deletionReason: row.deletion_reason,
    isDeleted: Boolean(row.deleted_at || row.status === 'anulado'),
    storage: row.storage
  };
}

function parseNonNegativeTotal(rawValue, message) {
  const value = Number(rawValue || 0);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(500, 'invalid_total', message);
  }
  return value;
}
