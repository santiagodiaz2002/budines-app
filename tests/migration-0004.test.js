import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createD1Repository } from '../functions/_shared/d1-repository.js';
import { createSale } from '../functions/_shared/records-service.js';
import { serializeRecord } from '../functions/_shared/serializers.js';
import { getSummary } from '../functions/_shared/summary.js';

let db;

afterEach(() => {
  db?.close();
  db = null;
});

describe('migracion 0004_add_quantity_unit', () => {
  it('interpreta registros existentes como GR y guarda nuevas ventas AP', async () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
    db.exec(readFileSync('migrations/0002_remove_incorrect_62000_record.sql', 'utf8'));
    db.exec(readFileSync('migrations/0004_add_quantity_unit.sql', 'utf8'));

    const repo = createD1Repository(wrapD1(db));
    const before = await getSummary(repo);
    const initial = serializeRecord(await repo.findRecordById('saldo-inicial-ars-3000'));

    expect(initial.quantityUnit).toBe('GR');
    expect(before.totalArs).toBe(3000);

    const created = await createSale(
      repo,
      {
        grams: '12',
        quantityUnit: 'AP',
        amountArs: '5000',
        idempotencyKey: 'idem-migration-ap'
      },
      { id: 'santi', displayName: 'Santi' },
      new Date('2026-07-23T15:00:00.000Z')
    );
    const after = await getSummary(repo);
    const listed = await repo.listRecords(10, 0);

    expect(created.record).toMatchObject({
      grams: 12,
      quantityUnit: 'AP',
      amountArs: 5000
    });
    expect(listed.find((record) => record.id === 'saldo-inicial-ars-3000').quantityUnit).toBe('GR');
    expect(after.totalArs).toBe(before.totalArs + 5000);
    expect(after.missingArs).toBe(112000);
  });
});

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
