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
        .prepare("SELECT COALESCE(SUM(amount_ars), 0) AS total_ars FROM records WHERE status = 'activo'")
        .first();

      const value = Number(row?.total_ars || 0);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new ApiError(500, 'invalid_total', 'El total acumulado no es válido.');
      }

      return value;
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
              amount_ars,
              status,
              commercial_date,
              created_at,
              voided_at,
              voided_by_user_id,
              idempotency_key,
              source
            )
            VALUES (?, 'venta', ?, ?, ?, 'activo', ?, ?, NULL, NULL, ?, 'web')
          `
        )
        .bind(
          record.id,
          record.userId,
          record.grams,
          record.amountArs,
          record.commercialDate,
          record.createdAt,
          record.idempotencyKey
        )
        .run();

      return this.findRecordById(record.id);
    },

    async markRecordVoided(recordId, userId, voidedAt) {
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
        .bind(voidedAt, userId, recordId)
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
    amountArs: Number(row.amount_ars),
    status: row.status,
    commercialDate: row.commercial_date,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidedByUserId: row.voided_by_user_id,
    voidedByDisplayName: row.voided_by_display_name,
    idempotencyKey: row.idempotency_key,
    source: row.source
  };
}
