import { describe, expect, it } from 'vitest';
import { calculateRecoverySummary, getSummary } from '../functions/_shared/summary.js';
import { createMemoryRepo } from './helpers/memory-repo.js';

describe('resumen financiero', () => {
  it('calcula el estado inicial esperado desde filas activas', async () => {
    const summary = await getSummary(createMemoryRepo());

    expect(summary.totalArs).toBe(65000);
    expect(summary.investmentArs).toBe(120000);
    expect(summary.investmentRecovered).toBe(false);
    expect(summary.missingArs).toBe(55000);
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
});
