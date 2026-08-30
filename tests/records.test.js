import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSale, createWithdrawal, deleteRecord } from '../functions/_shared/records-service.js';
import { getSummary } from '../functions/_shared/summary.js';
import { createMemoryRepo, saleRecord } from './helpers/memory-repo.js';

const user = {
  id: 'santi',
  displayName: 'Santi'
};

describe('registros, idempotencia y eliminacion logica', () => {
  it('incluye activos, excluye anulados y excluye bajas logicas', async () => {
    const repo = createMemoryRepo({
      records: [
        ...createMemoryRepo().records,
        saleRecord({ id: 'venta-activa', amountArs: 1000, status: 'activo' }),
        saleRecord({ id: 'venta-anulada', amountArs: 9000, status: 'anulado' }),
        saleRecord({ id: 'venta-eliminada', amountArs: 7000, deletedAt: '2026-07-12T00:00:00.000Z', isDeleted: true })
      ]
    });

    const summary = await getSummary(repo);
    const listed = await repo.listRecords(20, 0);

    expect(summary.totalArs).toBe(4000);
    expect(listed.map((record) => record.id)).toEqual(['saldo-inicial-ars-3000', 'venta-activa']);
    expect(repo.records.find((record) => record.id === 'saldo-inicial-ars-3000').quantity).toBeNull();
    expect(repo.records.find((record) => record.id === 'saldo-inicial-ars-3000').quantityUnit).toBe('GR');
  });

  it('primera peticion inserta, repeticion no duplica y nueva clave crea otra venta', async () => {
    const repo = createMemoryRepo();
    const input = {
      quantity: '25',
      quantityUnit: 'NORM',
      amountArs: '3000',
      idempotencyKey: 'idem-key-0000001'
    };

    const first = await createSale(repo, input, user, new Date('2026-07-12T15:00:00.000Z'));
    const repeated = await createSale(repo, input, user, new Date('2026-07-12T15:00:00.000Z'));
    const second = await createSale(
      repo,
      {
        ...input,
        idempotencyKey: 'idem-key-0000002'
      },
      user,
      new Date('2026-07-12T15:01:00.000Z')
    );

    expect(first.kind).toBe('created');
    expect(repeated.kind).toBe('existing');
    expect(second.kind).toBe('created');
    expect(first.record.quantityUnit).toBe('NORM');
    expect(repo.records.filter((record) => record.type === 'venta')).toHaveLength(2);
  });

  it('guarda tipos NORM y GEN sin cambiar totales economicos', async () => {
    const repo = createMemoryRepo();

    const norm = await createSale(repo, {
      quantity: '350',
      quantityUnit: 'NORM',
      amountArs: '7000',
      idempotencyKey: 'idem-key-unit-gr'
    }, user);
    const gen = await createSale(repo, {
      quantity: '12',
      quantityUnit: 'GEN',
      amountArs: '5000',
      idempotencyKey: 'idem-key-unit-ap'
    }, user);
    const summary = await getSummary(repo);

    expect(norm.record).toMatchObject({ quantity: 350, quantityUnit: 'NORM', amountArs: 7000 });
    expect(gen.record).toMatchObject({ quantity: 12, quantityUnit: 'GEN', amountArs: 5000 });
    expect(summary.totalArs).toBe(15000);
    expect(summary.missingArs).toBe(105000);
  });

  it('la misma clave con otra operacion produce conflicto', async () => {
    const repo = createMemoryRepo();
    const input = {
      quantity: '25',
      quantityUnit: 'NORM',
      amountArs: '3000',
      idempotencyKey: 'idem-key-0000003'
    };

    await createSale(repo, input, user);

    await expect(
      createSale(repo, {
        ...input,
        quantityUnit: 'GEN',
        amountArs: '62000'
      }, user)
    ).rejects.toMatchObject({
      status: 409,
      code: 'idempotency_conflict'
    });
  });

  it('rechaza venta nueva con cantidad nula, tipo histórico o usuario ausente', async () => {
    const repo = createMemoryRepo();

    await expect(
      createSale(repo, {
        quantity: '',
        quantityUnit: 'NORM',
        amountArs: '3000',
        idempotencyKey: 'idem-key-0000004'
      }, user)
    ).rejects.toMatchObject({
      code: 'required_field'
    });

    await expect(
      createSale(repo, {
        quantity: '25',
        quantityUnit: 'GR',
        amountArs: '3000',
        idempotencyKey: 'idem-key-0000007'
      }, user)
    ).rejects.toMatchObject({
      code: 'invalid_quantity_unit'
    });

    await expect(
      createSale(repo, {
        quantity: '25',
        quantityUnit: 'NORM',
        amountArs: '3000',
        idempotencyKey: 'idem-key-0000005'
      }, { id: null, displayName: 'Sin usuario' })
    ).rejects.toMatchObject({
      code: 'missing_user'
    });
  });

  it('registra retiro autenticado, lo resta de Ganancia real y no agrega cantidad', async () => {
    const repo = createMemoryRepo({
      investmentArs: 0,
      records: [saleRecord({ id: 'venta-base', amountArs: 188000 })]
    });

    const created = await createWithdrawal(
      repo,
      { amountArs: '108000', idempotencyKey: 'idem-retiro-108000' },
      user,
      new Date('2026-08-30T15:00:00.000Z')
    );
    const repeated = await createWithdrawal(
      repo,
      { amountArs: '108000', idempotencyKey: 'idem-retiro-108000' },
      user,
      new Date('2026-08-30T15:01:00.000Z')
    );
    const summary = await getSummary(repo);
    const listed = await repo.listRecords(20, 0);

    expect(created.kind).toBe('created');
    expect(repeated.kind).toBe('existing');
    expect(created.record).toMatchObject({
      type: 'retiro',
      userId: 'santi',
      quantity: null,
      quantityUnit: null,
      amountArs: 108000,
      commercialDate: '2026-08-30'
    });
    expect(summary).toMatchObject({
      totalArs: 80000,
      investmentArs: 0,
      investmentRecovered: true,
      profitArs: 80000
    });
    expect(listed.some((record) => record.type === 'retiro')).toBe(true);
  });

  it.each(['', '0', '-1', '1.5', 'texto'])('rechaza importe de retiro inválido %s', async (amountArs) => {
    const repo = createMemoryRepo();
    await expect(
      createWithdrawal(repo, { amountArs, idempotencyKey: 'idem-retiro-invalido' }, user)
    ).rejects.toMatchObject({ status: 400 });
  });

  it('dar de baja un retiro restaura el total sin borrar la fila', async () => {
    const repo = createMemoryRepo({
      investmentArs: 0,
      records: [saleRecord({ amountArs: 188000 })]
    });
    const created = await createWithdrawal(
      repo,
      { amountArs: '108000', idempotencyKey: 'idem-retiro-baja-1' },
      user
    );

    await deleteRecord(repo, created.record.id, user, 'ELIMINAR');
    const summary = await getSummary(repo);

    expect(summary.profitArs).toBe(188000);
    expect(repo.records.find((record) => record.id === created.record.id)).toMatchObject({
      type: 'retiro',
      status: 'anulado',
      isDeleted: true
    });
  });

  it('usuario autenticado elimina venta activa y la fila sigue existiendo', async () => {
    const repo = createMemoryRepo();
    const created = await createSale(repo, {
      quantity: '10',
      quantityUnit: 'NORM',
      amountArs: '5000',
      idempotencyKey: 'idem-key-0000006'
    }, user);

    const beforeDelete = await getSummary(repo);
    const deleted = await deleteRecord(repo, created.record.id, user, 'ELIMINAR', new Date('2026-07-12T16:00:00.000Z'));
    const repeated = await deleteRecord(repo, created.record.id, user, 'ELIMINAR', new Date('2026-07-12T16:01:00.000Z'));
    const afterDelete = await getSummary(repo);

    expect(beforeDelete.totalArs).toBe(8000);
    expect(deleted.kind).toBe('deleted');
    expect(repeated.kind).toBe('already_deleted');
    expect(afterDelete.totalArs).toBe(3000);
    expect(repo.records.find((record) => record.id === created.record.id)).toMatchObject({
      status: 'anulado',
      deletedByUserId: 'santi',
      isDeleted: true
    });
  });

  it('usuario autenticado elimina saldo inicial activo y el resumen lo excluye', async () => {
    const repo = createMemoryRepo();

    const deleted = await deleteRecord(repo, 'saldo-inicial-ars-3000', user, 'ELIMINAR', new Date('2026-07-12T17:00:00.000Z'));
    const repeated = await deleteRecord(repo, 'saldo-inicial-ars-3000', user, 'ELIMINAR', new Date('2026-07-12T17:01:00.000Z'));
    const summary = await getSummary(repo);
    const listed = await repo.listRecords(20, 0);

    expect(deleted.kind).toBe('deleted');
    expect(repeated.kind).toBe('already_deleted');
    expect(summary.totalArs).toBe(0);
    expect(summary.missingArs).toBe(120000);
    expect(listed).toHaveLength(0);
    expect(repo.records.find((record) => record.id === 'saldo-inicial-ars-3000')).toMatchObject({
      status: 'activo',
      deletedByUserId: 'santi',
      isDeleted: true
    });
  });

  it('rechaza identificador invalido, inexistente y confirmacion incorrecta', async () => {
    const repo = createMemoryRepo();

    await expect(deleteRecord(repo, '../x', user, 'ELIMINAR')).rejects.toMatchObject({
      status: 400,
      code: 'invalid_record_id'
    });

    await expect(deleteRecord(repo, 'registro-inexistente', user, 'ELIMINAR')).rejects.toMatchObject({
      status: 404,
      code: 'record_not_found'
    });

    await expect(deleteRecord(repo, 'saldo-inicial-ars-3000', user, 'ANULAR')).rejects.toMatchObject({
      status: 400,
      code: 'invalid_confirmation'
    });
  });

  it('la migracion inicial defiende nulos permitidos solo para saldo inicial', () => {
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
