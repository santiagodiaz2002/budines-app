import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createD1Repository } from '../functions/_shared/d1-repository.js';
import { createSale } from '../functions/_shared/records-service.js';
import { getOwnerSummary, getSummary } from '../functions/_shared/summary.js';

let db;

afterEach(() => {
  db?.close();
  db = null;
});

describe('migración 0006_start_profit_period', () => {
  it('cierra el período anterior, conserva sus filas y deja sumar ventas nuevas', async () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
    db.exec(readFileSync('migrations/0002_remove_incorrect_62000_record.sql', 'utf8'));
    db.exec(readFileSync('migrations/0004_add_quantity_unit.sql', 'utf8'));
    insertPreviousSale({
      id: 'venta-anterior-santi',
      userId: 'santi',
      amountArs: 17000,
      idempotencyKey: 'idem-anterior-santi'
    });
    insertPreviousSale({
      id: 'venta-anterior-leandro',
      userId: 'leandro',
      amountArs: 23000,
      idempotencyKey: 'idem-anterior-leandro'
    });

    const repo = createD1Repository(wrapD1(db));
    expect(activeRecordIds()).toEqual([
      'saldo-inicial-ars-3000',
      'venta-anterior-leandro',
      'venta-anterior-santi'
    ]);
    await expect(getSummary(repo)).resolves.toMatchObject({
      totalArs: 43000,
      investmentArs: 120000
    });
    await expect(getOwnerSummary(repo)).resolves.toEqual({
      santiArs: 17000,
      leandroArs: 23000,
      totalArs: 40000
    });

    const migration = readFileSync('migrations/0006_start_profit_period.sql', 'utf8');
    db.exec(migration);

    await expect(getSummary(repo)).resolves.toEqual({
      totalArs: 0,
      investmentArs: 0,
      state: 'recuperada',
      investmentRecovered: true,
      missingArs: 0,
      profitArs: 0
    });
    await expect(getOwnerSummary(repo)).resolves.toEqual({
      santiArs: 0,
      leandroArs: 0,
      totalArs: 0
    });
    await expect(repo.listRecords(20, 0)).resolves.toEqual([]);
    expect(activeRecordIds()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM records').get().count).toBe(4);
    expect(
      db.prepare(
        `
          SELECT record_id, deleted_by_user_id, reason
          FROM record_deletions
          ORDER BY record_id
        `
      ).all()
    ).toEqual([
      {
        record_id: 'saldo-inicial-ars-3000',
        deleted_by_user_id: null,
        reason: 'user_deleted'
      },
      {
        record_id: 'saldo-inicial-ars-62000',
        deleted_by_user_id: null,
        reason: 'incorrect_initial_balance'
      },
      {
        record_id: 'venta-anterior-leandro',
        deleted_by_user_id: null,
        reason: 'user_deleted'
      },
      {
        record_id: 'venta-anterior-santi',
        deleted_by_user_id: null,
        reason: 'user_deleted'
      }
    ]);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM records WHERE status = 'activo'").get().count
    ).toBe(4);

    const boundaryBeforeRetry = profitPeriodBoundary();
    const deletionsBeforeRetry = deletionCount();
    db.exec(migration);

    expect(profitPeriodBoundary()).toBe(boundaryBeforeRetry);
    expect(deletionCount()).toBe(deletionsBeforeRetry);
    await expect(getSummary(repo)).resolves.toMatchObject({
      totalArs: 0,
      investmentArs: 0,
      profitArs: 0
    });
    await expect(getOwnerSummary(repo)).resolves.toEqual({
      santiArs: 0,
      leandroArs: 0,
      totalArs: 0
    });

    const created = await createSale(
      repo,
      {
        grams: '12',
        quantityUnit: 'AP',
        amountArs: '5000',
        idempotencyKey: 'idem-periodo-ganancia-leandro'
      },
      { id: 'leandro', displayName: 'Leandro' },
      new Date('2099-01-02T15:00:00.000Z')
    );

    expect(created.kind).toBe('created');
    await expect(repo.listRecords(20, 0)).resolves.toEqual([
      expect.objectContaining({
        id: created.record.id,
        userId: 'leandro',
        amountArs: 5000,
        status: 'activo',
        isDeleted: false
      })
    ]);
    await expect(getSummary(repo)).resolves.toEqual({
      totalArs: 5000,
      investmentArs: 0,
      state: 'ganancia',
      investmentRecovered: true,
      missingArs: 0,
      profitArs: 5000
    });
    await expect(getOwnerSummary(repo)).resolves.toEqual({
      santiArs: 0,
      leandroArs: 5000,
      totalArs: 5000
    });

    db.exec(migration);

    expect(deletionCount()).toBe(deletionsBeforeRetry);
    expect(activeRecordIds()).toEqual([created.record.id]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM records').get().count).toBe(5);
    await expect(getSummary(repo)).resolves.toMatchObject({
      totalArs: 5000,
      investmentArs: 0,
      profitArs: 5000
    });
    await expect(getOwnerSummary(repo)).resolves.toEqual({
      santiArs: 0,
      leandroArs: 5000,
      totalArs: 5000
    });
  });
});

function insertPreviousSale({ id, userId, amountArs, idempotencyKey }) {
  db.prepare(
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
      VALUES (?, 'venta', ?, 10, 'GR', ?, 'activo', '2026-08-05',
        '2026-08-05T12:00:00.000Z', NULL, NULL, ?, 'web')
    `
  ).run(id, userId, amountArs, idempotencyKey);
}

function activeRecordIds() {
  return db.prepare(
    `
      SELECT r.id
      FROM records r
      LEFT JOIN record_deletions rd ON rd.record_id = r.id
      WHERE r.status = 'activo'
        AND rd.record_id IS NULL
      ORDER BY r.id
    `
  ).all().map((row) => row.id);
}

function deletionCount() {
  return db.prepare('SELECT COUNT(*) AS count FROM record_deletions').get().count;
}

function profitPeriodBoundary() {
  return db.prepare(
    "SELECT value FROM config WHERE key = 'profit_period_closed_through_record_rowid'"
  ).get().value;
}

function wrapD1(sqliteDb) {
  return {
    prepare(sql) {
      const statement = sqliteDb.prepare(sql);
      return {
        first: async () => statement.get() || null,
        all: async () => ({ results: statement.all() }),
        run: async () => statement.run(),
        bind(...bindings) {
          return {
            first: async () => statement.get(...bindings) || null,
            all: async () => ({ results: statement.all(...bindings) }),
            run: async () => statement.run(...bindings)
          };
        }
      };
    }
  };
}
