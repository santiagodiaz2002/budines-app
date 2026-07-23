import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSale, deleteRecord } from '../functions/_shared/records-service.js';
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
    expect(repo.records.find((record) => record.id === 'saldo-inicial-ars-3000').grams).toBeNull();
    expect(repo.records.find((record) => record.id === 'saldo-inicial-ars-3000').quantityUnit).toBe('GR');
  });

  it('primera peticion inserta, repeticion no duplica y nueva clave crea otra venta', async () => {
    const repo = createMemoryRepo();
    const input = {
      grams: '25',
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
    expect(first.record.quantityUnit).toBe('GR');
    expect(repo.records.filter((record) => record.type === 'venta')).toHaveLength(2);
  });

  it('guarda unidad AP y GR sin cambiar totales economicos', async () => {
    const repo = createMemoryRepo();

    const gr = await createSale(repo, {
      grams: '350',
      quantityUnit: 'GR',
      amountArs: '7000',
      idempotencyKey: 'idem-key-unit-gr'
    }, user);
    const ap = await createSale(repo, {
      grams: '12',
      quantityUnit: 'AP',
      amountArs: '5000',
      idempotencyKey: 'idem-key-unit-ap'
    }, user);
    const summary = await getSummary(repo);

    expect(gr.record).toMatchObject({ grams: 350, quantityUnit: 'GR', amountArs: 7000 });
    expect(ap.record).toMatchObject({ grams: 12, quantityUnit: 'AP', amountArs: 5000 });
    expect(summary.totalArs).toBe(15000);
    expect(summary.missingArs).toBe(105000);
  });

  it('la misma clave con otra operacion produce conflicto', async () => {
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
        quantityUnit: 'AP',
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
        quantityUnit: 'KG',
        amountArs: '3000',
        idempotencyKey: 'idem-key-0000007'
      }, user)
    ).rejects.toMatchObject({
      code: 'invalid_quantity_unit'
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

  it('usuario autenticado elimina venta activa y la fila sigue existiendo', async () => {
    const repo = createMemoryRepo();
    const created = await createSale(repo, {
      grams: '10',
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
