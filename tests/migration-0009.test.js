import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createD1Repository } from '../functions/_shared/d1-repository.js';
import { createSale, createWithdrawal } from '../functions/_shared/records-service.js';
import { getOwnerSummary, getSummary } from '../functions/_shared/summary.js';

let db;

afterEach(() => {
  db?.close();
  db = null;
});

describe('migración 0009_apply_current_accounting_reset', () => {
  it('es un no-op seguro en bases locales sin los IDs reconciliados de producción', async () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
    db.exec(readFileSync('migrations/0002_remove_incorrect_62000_record.sql', 'utf8'));
    db.exec(readFileSync('migrations/0004_add_quantity_unit.sql', 'utf8'));
    db.exec(readFileSync('migrations/0007_add_operations.sql', 'utf8'));
    db.exec(readFileSync('migrations/0008_add_accounting_scope.sql', 'utf8'));
    db.exec(readFileSync('migrations/0009_apply_current_accounting_reset.sql', 'utf8'));

    const repo = createD1Repository(wrapD1(db));
    expect(db.prepare('SELECT COUNT(*) AS count FROM accounting_resets').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM accounting_exclusions').get().count).toBe(0);
    await expect(getSummary(repo)).resolves.toMatchObject({
      totalArs: 3000,
      investmentArs: 120000
    });
  });

  it('conserva las ventas reconciliadas, ignora retiros históricos e incluye movimientos posteriores', async () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
    db.exec(readFileSync('migrations/0002_remove_incorrect_62000_record.sql', 'utf8'));
    db.exec(readFileSync('migrations/0004_add_quantity_unit.sql', 'utf8'));
    db.exec(readFileSync('migrations/0006_start_profit_period.sql', 'utf8'));
    db.exec(readFileSync('migrations/0007_add_operations.sql', 'utf8'));
    db.exec(readFileSync('migrations/0008_add_accounting_scope.sql', 'utf8'));

    insertLegacySale({
      id: 'venta-anterior-no-conservada',
      userId: 'leandro',
      quantity: 6,
      amountArs: 24000,
      commercialDate: '2026-08-24',
      createdAt: '2026-08-24T13:19:38.174Z'
    });
    insertLegacySale({
      id: '7067f4af-946c-4060-b528-02e61e9cba19',
      userId: 'santi',
      quantity: 1,
      amountArs: 5000,
      commercialDate: '2026-08-28',
      createdAt: '2026-08-28T16:41:28.944Z'
    });
    insertLegacySale({
      id: 'de2cfc16-2bc7-4e10-a864-b96e9581ca0d',
      userId: 'santi',
      quantity: 3,
      amountArs: 12000,
      commercialDate: '2026-08-28',
      createdAt: '2026-08-28T16:41:35.578Z'
    });
    insertLegacySale({
      id: 'd9c2c0bc-a71b-41a6-85ee-1f659c1eca19',
      userId: 'leandro',
      quantity: 1,
      amountArs: 5000,
      commercialDate: '2026-08-28',
      createdAt: '2026-08-28T18:55:48.382Z'
    });
    insertLegacySale({
      id: 'b1c6d5da-7df5-4940-94dd-7da92641384f',
      userId: 'santi',
      quantity: 7,
      amountArs: 28000,
      commercialDate: '2026-08-29',
      createdAt: '2026-08-29T04:04:01.544Z'
    });
    insertLegacySale({
      id: '635f4977-5a33-45d2-b1e9-7d01619c23e9',
      userId: 'santi',
      quantity: 3,
      amountArs: 12000,
      commercialDate: '2026-08-30',
      createdAt: '2026-08-30T21:23:55.487Z'
    });

    insertOperation({
      id: '936bfbda-0de6-4877-be61-a6bea1f7ef7e',
      type: 'retiro',
      userId: 'santi',
      amountArs: 138000,
      commercialDate: '2026-09-02',
      createdAt: '2026-09-02T15:58:37.924Z'
    });
    insertOperation({
      id: 'be12128b-9f3d-4773-ab60-f8169c3b21c9',
      type: 'venta',
      userId: 'leandro',
      quantity: 3,
      quantityUnit: 'NORM',
      amountArs: 12000,
      commercialDate: '2026-09-02',
      createdAt: '2026-09-02T19:21:30.513Z'
    });
    insertOperation({
      id: 'f5a7fb17-5967-45b0-af86-7604e5bd145b',
      type: 'venta',
      userId: 'leandro',
      quantity: 2,
      quantityUnit: 'GEN',
      amountArs: 16000,
      commercialDate: '2026-09-02',
      createdAt: '2026-09-02T19:21:39.332Z'
    });
    insertOperation({
      id: 'bf888f1a-385e-4d30-a136-0a3275f64b9d',
      type: 'venta',
      userId: 'santi',
      quantity: 7,
      quantityUnit: 'NORM',
      amountArs: 28000,
      commercialDate: '2026-09-02',
      createdAt: '2026-09-03T01:13:23.458Z'
    });
    insertOperation({
      id: '59a526ba-3e85-4917-8c5c-f035d4e95932',
      type: 'venta',
      userId: 'leandro',
      quantity: 1,
      quantityUnit: 'NORM',
      amountArs: 5000,
      commercialDate: '2026-09-02',
      createdAt: '2026-09-03T02:27:08.314Z'
    });
    insertOperation({
      id: 'a11e8f68-411e-460f-aaac-ce98d2d3d7f7',
      type: 'retiro',
      userId: 'leandro',
      amountArs: 30000,
      commercialDate: '2026-09-02',
      createdAt: '2026-09-03T02:42:06.720Z'
    });
    insertOperation({
      id: 'a7fbb2ae-a968-4a97-8d7e-e1ced6270b79',
      type: 'venta',
      userId: 'santi',
      quantity: 3,
      quantityUnit: 'NORM',
      amountArs: 12000,
      commercialDate: '2026-09-03',
      createdAt: '2026-09-03T21:02:55.800Z'
    });

    const migration = readFileSync('migrations/0009_apply_current_accounting_reset.sql', 'utf8');
    db.exec(migration);

    const repo = createD1Repository(wrapD1(db));
    await expect(getSummary(repo)).resolves.toEqual({
      totalArs: 135000,
      recoveryTotalArs: 135000,
      investmentArs: 0,
      state: 'ganancia',
      investmentRecovered: true,
      missingArs: 0,
      profitArs: 135000
    });
    await expect(getOwnerSummary(repo)).resolves.toEqual({
      santiArs: 97000,
      leandroArs: 38000,
      totalArs: 135000
    });

    expect(
      db.prepare(
        `
          SELECT storage, movement_id
          FROM accounting_exclusions
          ORDER BY storage, movement_id
        `
      ).all()
    ).toEqual([
      { storage: 'operations', movement_id: '936bfbda-0de6-4877-be61-a6bea1f7ef7e' },
      { storage: 'operations', movement_id: 'a11e8f68-411e-460f-aaac-ce98d2d3d7f7' },
      { storage: 'records', movement_id: 'saldo-inicial-ars-3000' },
      { storage: 'records', movement_id: 'saldo-inicial-ars-62000' },
      { storage: 'records', movement_id: 'venta-anterior-no-conservada' }
    ]);

    const listedIds = (await repo.listRecords(50, 0)).map((record) => record.id);
    expect(listedIds).toEqual(expect.arrayContaining([
      'venta-anterior-no-conservada',
      '936bfbda-0de6-4877-be61-a6bea1f7ef7e',
      'a11e8f68-411e-460f-aaac-ce98d2d3d7f7'
    ]));

    const exclusionsBeforeRetry = db.prepare('SELECT COUNT(*) AS count FROM accounting_exclusions').get().count;
    db.exec(migration);
    expect(db.prepare('SELECT COUNT(*) AS count FROM accounting_exclusions').get().count).toBe(exclusionsBeforeRetry);
    await expect(getSummary(repo)).resolves.toMatchObject({ totalArs: 135000, profitArs: 135000 });

    await createSale(repo, {
      quantity: '1',
      quantityUnit: 'NORM',
      amountArs: '4000',
      idempotencyKey: 'idem-reset-future-sale'
    }, { id: 'santi', displayName: 'Santi' });
    await expect(getSummary(repo)).resolves.toMatchObject({ totalArs: 139000, profitArs: 139000 });

    await createWithdrawal(repo, {
      amountArs: '3000',
      idempotencyKey: 'idem-reset-future-withdrawal'
    }, { id: 'leandro', displayName: 'Leandro' });
    await expect(getSummary(repo)).resolves.toMatchObject({ totalArs: 136000, profitArs: 136000 });
    await expect(getOwnerSummary(repo)).resolves.toEqual({
      santiArs: 101000,
      leandroArs: 35000,
      totalArs: 136000
    });

    db.exec(migration);
    expect(db.prepare('SELECT COUNT(*) AS count FROM accounting_exclusions').get().count).toBe(exclusionsBeforeRetry);
    await expect(getSummary(repo)).resolves.toMatchObject({ totalArs: 136000, profitArs: 136000 });
  });
});

function insertLegacySale({ id, userId, quantity, amountArs, commercialDate, createdAt }) {
  db.prepare(
    `
      INSERT INTO records (
        id, type, user_id, grams, quantity_unit, amount_ars, status,
        commercial_date, created_at, voided_at, voided_by_user_id,
        idempotency_key, source
      )
      VALUES (?, 'venta', ?, ?, 'GR', ?, 'activo', ?, ?, NULL, NULL, ?, 'web')
    `
  ).run(id, userId, quantity, amountArs, commercialDate, createdAt, `idem-${id}`);
}

function insertOperation({
  id,
  type,
  userId,
  quantity = null,
  quantityUnit = null,
  amountArs,
  commercialDate,
  createdAt
}) {
  db.prepare(
    `
      INSERT INTO operations (
        id, type, user_id, quantity, quantity_unit, amount_ars, status,
        commercial_date, created_at, voided_at, voided_by_user_id,
        idempotency_key, source
      )
      VALUES (?, ?, ?, ?, ?, ?, 'activo', ?, ?, NULL, NULL, ?, 'web')
    `
  ).run(id, type, userId, quantity, quantityUnit, amountArs, commercialDate, createdAt, `idem-${id}`);
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
