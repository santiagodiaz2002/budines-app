import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSale, voidSale } from '../functions/_shared/records-service.js';
import { getSummary } from '../functions/_shared/summary.js';
import { createMemoryRepo } from './helpers/memory-repo.js';

const user = {
  id: 'santi',
  displayName: 'Santi'
};

describe('registros e idempotencia', () => {
  it('incluye activos, excluye anulados e incluye saldos iniciales', async () => {
    const repo = createMemoryRepo({
      records: [
        ...createMemoryRepo().records,
        saleRecord({ id: 'venta-activa', amountArs: 1000, status: 'activo' }),
        saleRecord({ id: 'venta-anulada', amountArs: 9000, status: 'anulado' })
      ]
    });

    const summary = await getSummary(repo);
    expect(summary.totalArs).toBe(66000);
    expect(repo.records.find((record) => record.type === 'saldo_inicial').grams).toBeNull();
  });

  it('primera petición inserta, repetición no duplica y nueva clave crea otra venta', async () => {
    const repo = createMemoryRepo();
    const input = {
      grams: '25',
      amountArs: '3000',
      idempotencyKey: 'idem-key-0000001'
    };

    const first = await createSale(repo, input, user, new Date('2026-07-11T15:00:00.000Z'));
    const repeated = await createSale(repo, input, user, new Date('2026-07-11T15:00:00.000Z'));
    const second = await createSale(
      repo,
      {
        ...input,
        idempotencyKey: 'idem-key-0000002'
      },
      user,
      new Date('2026-07-11T15:01:00.000Z')
    );

    expect(first.kind).toBe('created');
    expect(repeated.kind).toBe('existing');
    expect(second.kind).toBe('created');
    expect(repo.records.filter((record) => record.type === 'venta')).toHaveLength(2);
  });

  it('la misma clave con otra operación produce conflicto', async () => {
    const repo = createMemoryRepo();
    const input = {
      grams: '25',
      amountArs: '3000',
      idempotencyKey: 'idem-key-0000003'
    };

    await createSale(repo, input, user);

    await expect(
      createSale(repo, {
        ...input,
        amountArs: '62000'
      }, user)
    ).rejects.toMatchObject({
      status: 409,
      code: 'idempotency_conflict'
    });
  });

  it('rechaza venta normal con gramos nulos o usuario ausente', async () => {
    const repo = createMemoryRepo();

    await expect(
      createSale(repo, {
        grams: '',
        amountArs: '3000',
        idempotencyKey: 'idem-key-0000004'
      }, user)
    ).rejects.toMatchObject({
      code: 'required_field'
    });

    await expect(
      createSale(repo, {
        grams: '25',
        amountArs: '3000',
        idempotencyKey: 'idem-key-0000005'
      }, { id: null, displayName: 'Sin usuario' })
    ).rejects.toMatchObject({
      code: 'missing_user'
    });
  });

  it('anula ventas activas, impide saldo inicial y repite sin estados contradictorios', async () => {
    const repo = createMemoryRepo();
    const created = await createSale(repo, {
      grams: '10',
      amountArs: '5000',
      idempotencyKey: 'idem-key-0000006'
    }, user);

    const beforeVoid = await getSummary(repo);
    const voided = await voidSale(repo, created.record.id, user, 'ANULAR', new Date('2026-07-11T16:00:00.000Z'));
    const repeated = await voidSale(repo, created.record.id, user, 'ANULAR', new Date('2026-07-11T16:01:00.000Z'));
    const afterVoid = await getSummary(repo);

    expect(beforeVoid.totalArs).toBe(70000);
    expect(voided.kind).toBe('voided');
    expect(repeated.kind).toBe('already_voided');
    expect(afterVoid.totalArs).toBe(65000);
    expect(repo.records.find((record) => record.id === created.record.id).voidedByUserId).toBe('santi');

    await expect(
      voidSale(repo, 'saldo-inicial-ars-3000', user, 'ANULAR')
    ).rejects.toMatchObject({
      status: 409,
      code: 'initial_balance_not_voidable'
    });
  });

  it('la migración defiende nulos permitidos solo para saldo inicial', () => {
    const sql = readFileSync('migrations/0001_initial.sql', 'utf8');

    expect(sql).toContain("type = 'saldo_inicial'");
    expect(sql).toContain('user_id IS NULL');
    expect(sql).toContain('grams IS NULL');
    expect(sql).toContain("type = 'venta'");
    expect(sql).toContain('user_id IS NOT NULL');
    expect(sql).toContain('grams IS NOT NULL');
    expect(sql).toContain('UNIQUE');
  });
});

function saleRecord(overrides = {}) {
  return {
    id: 'venta',
    type: 'venta',
    userId: 'santi',
    userDisplayName: 'Santi',
    grams: 10,
    amountArs: 1000,
    status: 'activo',
    commercialDate: '2026-07-11',
    createdAt: '2026-07-11T15:00:00.000Z',
    voidedAt: null,
    voidedByUserId: null,
    voidedByDisplayName: null,
    idempotencyKey: `idem-${crypto.randomUUID()}`,
    source: 'web',
    ...overrides
  };
}
