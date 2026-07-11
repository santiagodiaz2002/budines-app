import { describe, expect, it } from 'vitest';
import { formatArs, formatCommercialDate } from '../public/js/format.js';
import { validateSaleFields } from '../public/js/validation.js';

describe('lógica frontend compartida', () => {
  it('normaliza importes y gramos como texto entero', () => {
    expect(validateSaleFields('25', '62000')).toEqual({
      ok: true,
      grams: 25,
      amountArs: 62000
    });

    expect(validateSaleFields('25', '1,5')).toMatchObject({
      ok: false,
      field: 'amount'
    });
  });

  it('presenta importes con locale es-AR y moneda ARS', () => {
    expect(formatArs(65000)).toContain('65.000');
    expect(formatArs(120000)).toContain('120.000');
  });

  it('presenta fecha informada y fecha sin informar', () => {
    expect(formatCommercialDate(null)).toBe('Fecha sin informar');
    expect(formatCommercialDate('2026-07-11')).toContain('11');
  });
});
