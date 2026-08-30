import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createD1Repository } from '../functions/_shared/d1-repository.js';
import { createSale, createWithdrawal } from '../functions/_shared/records-service.js';
import { serializeRecord } from '../functions/_shared/serializers.js';
import { getOwnerSummary, getSummary } from '../functions/_shared/summary.js';

let db;

afterEach(() => {
  db?.close();
  db = null;
});

describe('migración 0007_add_operations', () => {
  it('preserva GR/AP y persiste NORM, GEN y retiros con cálculo canónico', async () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
    db.exec(readFileSync('migrations/0002_remove_incorrect_62000_record.sql', 'utf8'));
    db.exec(readFileSync('migrations/0004_add_quantity_unit.sql', 'utf8'));
    insertLegacyApSale();
    db.exec(readFileSync('migrations/0006_start_profit_period.sql', 'utf8'));
    db.exec(readFileSync('migrations/0007_add_operations.sql', 'utf8'));

    let repo = createD1Repository(wrapD1(db));
    const legacy = serializeRecord(await repo.findRecordById('venta-historica-ap'));
    expect(legacy).toMatchObject({
      type: 'venta',
      quantity: 12,
      quantityUnit: 'AP'
    });

    await createSale(repo, {
      quantity: '100',
      quantityUnit: 'NORM',
      amountArs: '100000',
      idempotencyKey: 'idem-migration-norm-1'
    }, { id: 'santi', displayName: 'Santi' });
    await createSale(repo, {
      quantity: '88',
      quantityUnit: 'GEN',
      amountArs: '88000',
      idempotencyKey: 'idem-migration-gen-01'
    }, { id: 'santi', displayName: 'Santi' });
    await createWithdrawal(repo, {
      amountArs: '108000',
      idempotencyKey: 'idem-migration-retiro'
    }, { id: 'santi', displayName: 'Santi' });

    await expect(getSummary(repo)).resolves.toMatchObject({
      totalArs: 80000,
      investmentArs: 0,
      investmentRecovered: true,
      profitArs: 80000
    });
    await expect(getOwnerSummary(repo)).resolves.toEqual({
      santiArs: 80000,
      leandroArs: 0,
      totalArs: 80000
    });

    repo = createD1Repository(wrapD1(db));
    const listed = (await repo.listRecords(10, 0)).map(serializeRecord);
    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'venta', quantityUnit: 'NORM', amountArs: 100000 }),
      expect.objectContaining({ type: 'venta', quantityUnit: 'GEN', amountArs: 88000 }),
      expect.objectContaining({
        type: 'retiro',
        quantity: null,
        quantityUnit: null,
        amountArs: 108000,
        user: expect.objectContaining({ id: 'santi', displayName: 'Santi' })
      })
    ]));
    await expect(getSummary(repo)).resolves.toMatchObject({ totalArs: 80000, profitArs: 80000 });
  });

  it('el esquema impide GR/AP nuevos y cantidades en retiros', () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
    db.exec(readFileSync('migrations/0004_add_quantity_unit.sql', 'utf8'));
    db.exec(readFileSync('migrations/0007_add_operations.sql', 'utf8'));

    expect(() => insertRawOperation({ type: 'venta', quantity: 1, unit: 'GR' })).toThrow();
    expect(() => insertRawOperation({ type: 'retiro', quantity: 1, unit: 'NORM' })).toThrow();
  });
});

function insertLegacyApSale() {
  db.prepare(`
    INSERT INTO records (
      id, type, user_id, grams, quantity_unit, amount_ars, status,
      commercial_date, created_at, voided_at, voided_by_user_id,
      idempotency_key, source
    )
    VALUES ('venta-historica-ap', 'venta', 'leandro', 12, 'AP', 5000,
      'activo', '2026-08-01', '2026-08-01T15:00:00.000Z', NULL, NULL,
      'idem-historica-ap-01', 'web')
  `).run();
}

function insertRawOperation({ type, quantity, unit }) {
  db.prepare(`
    INSERT INTO operations (
      id, type, user_id, quantity, quantity_unit, amount_ars, status,
      commercial_date, created_at, idempotency_key, source
    ) VALUES (?, ?, 'santi', ?, ?, 1000, 'activo', '2026-08-30',
      '2026-08-30T15:00:00.000Z', ?, 'web')
  `).run(crypto.randomUUID(), type, quantity, unit, `idem-${crypto.randomUUID()}`);
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
