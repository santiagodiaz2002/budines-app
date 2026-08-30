import { describe, expect, it } from 'vitest';
import {
  calculateOwnerSummary,
  calculateRecoverySummary,
  getOwnerSummary,
  getSummary
} from '../functions/_shared/summary.js';
import { createMemoryRepo, saleRecord, withdrawalRecord } from './helpers/memory-repo.js';

describe('resumen financiero', () => {
  it('calcula el estado inicial esperado desde filas activas', async () => {
    const summary = await getSummary(createMemoryRepo());

    expect(summary.totalArs).toBe(3000);
    expect(summary.investmentArs).toBe(120000);
    expect(summary.investmentRecovered).toBe(false);
    expect(summary.missingArs).toBe(117000);
    expect(summary.profitArs).toBe(0);
  });

  it('calcula inversión recuperada exacta', () => {
    const summary = calculateRecoverySummary(120000, 120000);

    expect(summary.totalArs).toBe(120000);
    expect(summary.investmentRecovered).toBe(true);
    expect(summary.missingArs).toBe(0);
    expect(summary.profitArs).toBe(0);
    expect(summary.state).toBe('recuperada');
  });

  it('calcula ganancia real solo por encima de la inversión', () => {
    const summary = calculateRecoverySummary(145000, 120000);

    expect(summary.totalArs).toBe(145000);
    expect(summary.investmentRecovered).toBe(true);
    expect(summary.missingArs).toBe(0);
    expect(summary.profitArs).toBe(25000);
    expect(summary.state).toBe('ganancia');
  });

  it('resta retiros de la ganancia sin revertir la inversión recuperada', () => {
    expect(calculateRecoverySummary(188000, 0, 108000)).toEqual({
      totalArs: 80000,
      recoveryTotalArs: 188000,
      investmentArs: 0,
      state: 'ganancia',
      investmentRecovered: true,
      missingArs: 0,
      profitArs: 80000
    });

    expect(calculateRecoverySummary(145000, 120000, 30000)).toMatchObject({
      totalArs: 115000,
      investmentRecovered: true,
      missingArs: 0,
      profitArs: -5000
    });
  });
});

describe('resumen por responsable', () => {
  it('suma solo ventas activas y no eliminadas de Santi y Leandro', async () => {
    const repo = createMemoryRepo({
      records: [
        ...createMemoryRepo().records,
        saleRecord({ id: 'venta-santi', userId: 'santi', amountArs: 1250 }),
        saleRecord({ id: 'venta-leandro', userId: 'leandro', userDisplayName: 'Leandro', amountArs: 2750 }),
        saleRecord({ id: 'venta-anulada', userId: 'santi', amountArs: 9000, status: 'anulado' }),
        saleRecord({
          id: 'venta-eliminada',
          userId: 'leandro',
          userDisplayName: 'Leandro',
          amountArs: 8000,
          deletedAt: '2026-07-31T12:00:00.000Z',
          isDeleted: true
        })
      ]
    });

    await expect(getOwnerSummary(repo)).resolves.toEqual({
      santiArs: 1250,
      leandroArs: 2750,
      totalArs: 4000
    });
  });

  it('devuelve cero para ambos usuarios cuando no tienen ventas', async () => {
    await expect(getOwnerSummary(createMemoryRepo())).resolves.toEqual({
      santiArs: 0,
      leandroArs: 0,
      totalArs: 0
    });
  });

  it('resta los retiros al usuario autenticado correspondiente', async () => {
    const repo = createMemoryRepo({
      records: [
        saleRecord({ userId: 'santi', amountArs: 188000 }),
        withdrawalRecord({ userId: 'santi', amountArs: 108000 }),
        withdrawalRecord({
          userId: 'leandro',
          userDisplayName: 'Leandro',
          amountArs: 5000
        })
      ]
    });

    await expect(getOwnerSummary(repo)).resolves.toEqual({
      santiArs: 80000,
      leandroArs: -5000,
      totalArs: 75000
    });
  });

  it('rechaza valores nulos o una suma fuera del rango seguro y admite saldos negativos', async () => {
    const invalidRepo = {
      async getActiveOwnerTotalsArs() {
        return { santiArs: null, leandroArs: 0 };
      }
    };

    await expect(getOwnerSummary(invalidRepo)).rejects.toMatchObject({
      status: 500,
      code: 'invalid_summary_value'
    });
    expect(calculateOwnerSummary(-1, 0)).toEqual({ santiArs: -1, leandroArs: 0, totalArs: -1 });
    for (const values of [[Number.MAX_SAFE_INTEGER, 1]]) {
      let error;
      try {
        calculateOwnerSummary(...values);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({
        status: 500,
        code: 'invalid_summary_value'
      });
    }
  });
});
