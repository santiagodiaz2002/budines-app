import { ALLOWED_USERS } from './constants.js';
import { ApiError } from './http.js';

export function createD1Repository(db) {
  return {
    async getInitialInvestmentArs() {
      const row = await db
        .prepare("SELECT value FROM config WHERE key = 'initial_investment_ars'")
        .first();

      const value = Number(row?.value);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new ApiError(500, 'missing_investment', 'La inversión inicial no está configurada.');
      }

      return value;
    },

    async getActiveTotalArs() {
      const row = await db
        .prepare(
          `
            SELECT COALESCE(SUM(r.amount_ars), 0) AS total_ars
            FROM records r
            LEFT JOIN record_deletions rd ON rd.record_id = r.id
            WHERE r.status = 'activo'
              AND rd.record_id IS NULL
          `
        )
        .first();

      const value = Number(row?.total_ars || 0);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new ApiError(500, 'invalid_total', 'El total acumulado no es válido.');
      }

      return value;
    },

    async getActiveOwnerTotalsArs() {
      const santiId = ALLOWED_USERS.santi.id;
      const leandroId = ALLOWED_USERS.leandro.id;
      const row = await db
        .prepare(
          `
            SELECT
              COALESCE(SUM(CASE WHEN r.user_id = ? THEN r.amount_ars ELSE 0 END), 0) AS santi_ars,
              COALESCE(SUM(CASE WHEN r.user_id = ? THEN r.amount_ars ELSE 0 END), 0) AS leandro_ars
            FROM records r
            LEFT JOIN record_deletions rd ON rd.record_id = r.id
            WHERE r.type = 'venta'
              AND r.status = 'activo'
              AND rd.record_id IS NULL
              AND r.user_id IN (?, ?)
          `
        )
        .bind(santiId, leandroId, santiId, leandroId)
        .first();

      return {
        santiArs: row?.santi_ars,
        leandroArs: row?.leandro_ars
      };
    },

    async findRecordById(recordId) {
      const row = await recordSelect(db, 'r.id = ?', [recordId]);
      return row ? mapRecord(row) : null;
    },

    async findRecordByIdempotencyKey(idempotencyKey) {
      const row = await recordSelect(db, 'r.idempotency_key = ?', [idempotencyKey]);
      return row ? mapRecord(row) : null;
    },

    async insertSale(record) {
      await db
        .prepare(
          `
            INSERT INTO records (
              id,
              type,
              user_id,
              grams,
              quantity_unit,
              amount_ars,
              status,
              commercial_date,
              created_at,
              voided_at,
              voided_by_user_id,
              idempotency_key,
              source
            )
            VALUES (?, 'venta', ?, ?, ?, ?, 'activo', ?, ?, NULL, NULL, ?, 'web')
          `
        )
        .bind(
          record.id,
          record.userId,
          record.grams,
          record.quantityUnit,
          record.amountArs,
          record.commercialDate,
          record.createdAt,
          record.idempotencyKey
        )
        .run();

      return this.findRecordById(record.id);
    },

    async markRecordDeleted(recordId, userId, deletedAt) {
      const record = await this.findRecordById(recordId);
      if (!record) {
        throw new ApiError(404, 'record_not_found', 'El registro no existe.');
      }

      if (record.status !== 'activo' || record.deletedAt) {
        return record;
      }

      if (record.type === 'venta') {
        await db
          .prepare(
            `
              UPDATE records
              SET status = 'anulado',
                  voided_at = ?,
                  voided_by_user_id = ?
              WHERE id = ?
                AND type = 'venta'
                AND status = 'activo'
            `
          )
          .bind(deletedAt, userId, recordId)
          .run();
      }

      await db
        .prepare(
          `
            INSERT OR IGNORE INTO record_deletions (
              record_id,
              deleted_at,
              deleted_by_user_id,
              reason
            )
            VALUES (?, ?, ?, 'user_deleted')
          `
        )
        .bind(recordId, deletedAt, userId)
        .run();

      const updated = await this.findRecordById(recordId);
      if (!updated) {
        throw new ApiError(404, 'record_not_found', 'El registro no existe.');
      }
      return updated;
    },

    async listRecords(limit, offset) {
      const result = await db
        .prepare(
          `
            SELECT
              r.id,
              r.type,
              r.user_id,
              u.display_name AS user_display_name,
              r.grams,
              COALESCE(r.quantity_unit, 'GR') AS quantity_unit,
              r.amount_ars,
              r.status,
              r.commercial_date,
              r.created_at,
              r.voided_at,
              r.voided_by_user_id,
              vu.display_name AS voided_by_display_name,
              r.idempotency_key,
              r.source
            FROM records r
            LEFT JOIN users u ON u.id = r.user_id
            LEFT JOIN users vu ON vu.id = r.voided_by_user_id
            LEFT JOIN record_deletions rd ON rd.record_id = r.id
            LEFT JOIN users du ON du.id = rd.deleted_by_user_id
            WHERE r.status = 'activo'
              AND rd.record_id IS NULL
            ORDER BY
              COALESCE(r.commercial_date, substr(r.created_at, 1, 10)) DESC,
              r.created_at DESC,
              r.id DESC
            LIMIT ?
            OFFSET ?
          `
        )
        .bind(limit, offset)
        .all();

      return result.results.map(mapRecord);
    }
  };
}

async function recordSelect(db, whereClause, bindings) {
  return db
    .prepare(
      `
        SELECT
          r.id,
          r.type,
          r.user_id,
          u.display_name AS user_display_name,
          r.grams,
          COALESCE(r.quantity_unit, 'GR') AS quantity_unit,
          r.amount_ars,
          r.status,
          r.commercial_date,
          r.created_at,
          r.voided_at,
          r.voided_by_user_id,
          vu.display_name AS voided_by_display_name,
          r.idempotency_key,
          r.source,
          rd.deleted_at,
          rd.deleted_by_user_id,
          du.display_name AS deleted_by_display_name,
          rd.reason AS deletion_reason
        FROM records r
        LEFT JOIN users u ON u.id = r.user_id
        LEFT JOIN users vu ON vu.id = r.voided_by_user_id
        LEFT JOIN record_deletions rd ON rd.record_id = r.id
        LEFT JOIN users du ON du.id = rd.deleted_by_user_id
        WHERE ${whereClause}
        LIMIT 1
      `
    )
    .bind(...bindings)
    .first();
}

function mapRecord(row) {
  return {
    id: row.id,
    type: row.type,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    grams: row.grams === null || row.grams === undefined ? null : Number(row.grams),
    quantityUnit: row.quantity_unit === 'AP' ? 'AP' : 'GR',
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
    isDeleted: Boolean(row.deleted_at || row.status === 'anulado')
  };
}
