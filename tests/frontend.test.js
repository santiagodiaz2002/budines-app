import { describe, expect, it } from 'vitest';
import { formatArs, formatCommercialDate } from '../public/js/format.js';
import { validateSaleFields } from '../public/js/validation.js';

describe('lógica frontend compartida', () => {
  it('normaliza importes y cantidad como texto entero con unidad', () => {
    expect(validateSaleFields('25', 'GR', '62000')).toEqual({
      ok: true,
      grams: 25,
      quantityUnit: 'GR',
      amountArs: 62000
    });

    expect(validateSaleFields('25', 'AP', '1,5')).toMatchObject({
      ok: false,
      field: 'amount'
    });

    expect(validateSaleFields('25', 'KG', '62000')).toMatchObject({
      ok: false,
      field: 'quantityUnit'
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
