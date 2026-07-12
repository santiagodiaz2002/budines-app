import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { calculateRecoverySummary } from '../functions/_shared/summary.js';

let db;

afterEach(() => {
  db?.close();
  db = null;
});

describe('migracion 0002_remove_incorrect_62000_record', () => {
  it('da de baja logica solo el saldo inicial incorrecto y es repetible', () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
    db.exec(`
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
      VALUES (
        'venta-real-62000',
        'venta',
        'santi',
        25,
        62000,
        'activo',
        '2026-07-12',
        '2026-07-12T12:00:00.000Z',
        NULL,
        NULL,
        'idem-venta-real-62000',
        'web'
      );
    `);

    const migration = readFileSync('migrations/0002_remove_incorrect_62000_record.sql', 'utf8');
    db.exec(migration);
    db.exec(migration);

    const deletions = db.prepare('SELECT record_id, reason FROM record_deletions ORDER BY record_id').all();
    const records = db.prepare(`
      SELECT r.id, r.amount_ars, r.status, rd.deleted_at
      FROM records r
      LEFT JOIN record_deletions rd ON rd.record_id = r.id
      ORDER BY r.id
    `).all();
    const total = db.prepare(`
      SELECT COALESCE(SUM(r.amount_ars), 0) AS total_ars
      FROM records r
      LEFT JOIN record_deletions rd ON rd.record_id = r.id
      WHERE r.status = 'activo'
        AND rd.record_id IS NULL
    `).get().total_ars;
    const summary = calculateRecoverySummary(total, 120000);

    expect(deletions).toEqual([
      {
        record_id: 'saldo-inicial-ars-62000',
        reason: 'incorrect_initial_balance'
      }
    ]);
    expect(records.find((record) => record.id === 'saldo-inicial-ars-3000')).toMatchObject({
      amount_ars: 3000,
      status: 'activo',
      deleted_at: null
    });
    expect(records.find((record) => record.id === 'saldo-inicial-ars-62000')).toMatchObject({
      amount_ars: 62000,
      status: 'activo'
    });
    expect(records.find((record) => record.id === 'saldo-inicial-ars-62000').deleted_at).toBeTypeOf('string');
    expect(records.find((record) => record.id === 'venta-real-62000')).toMatchObject({
      amount_ars: 62000,
      status: 'activo',
      deleted_at: null
    });
    expect(total).toBe(65000);
    expect(summary.missingArs).toBe(55000);
  });

  it('deja total 3000 y falta recuperar 117000 cuando no hay ventas reales', () => {
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
    db.exec(readFileSync('migrations/0002_remove_incorrect_62000_record.sql', 'utf8'));

    const total = db.prepare(`
      SELECT COALESCE(SUM(r.amount_ars), 0) AS total_ars
      FROM records r
      LEFT JOIN record_deletions rd ON rd.record_id = r.id
      WHERE r.status = 'activo'
        AND rd.record_id IS NULL
    `).get().total_ars;
    const summary = calculateRecoverySummary(total, 120000);

    expect(total).toBe(3000);
    expect(summary.missingArs).toBe(117000);
    expect(summary.profitArs).toBe(0);
  });
});
