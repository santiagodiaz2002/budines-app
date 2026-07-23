import { describe, expect, it } from 'vitest';
import {
  parsePositiveIntegerText as parseServerInteger,
  parseQuantityUnit as parseServerQuantityUnit
} from '../functions/_shared/validation.js';
import {
  parsePositiveIntegerText as parseClientInteger,
  validateQuantityUnit as validateClientQuantityUnit
} from '../public/js/validation.js';

describe('validación de enteros positivos', () => {
  const validValues = ['1', '25', '3000', '62000'];
  const invalidValues = ['', '0', '-1', '1.5', '1,5', '2e3', 'texto', '1 2', ' 12', '12 ', '1'.repeat(13)];

  it.each(validValues)('acepta %s', (value) => {
    expect(parseServerInteger(value, 'Campo')).toBe(Number(value));
    expect(parseClientInteger(value, 'Campo')).toEqual({
      ok: true,
      value: Number(value)
    });
  });

  it.each(invalidValues)('rechaza %s', (value) => {
    expect(() => parseServerInteger(value, 'Campo')).toThrow();
    expect(parseClientInteger(value, 'Campo').ok).toBe(false);
  });

  it('rechaza números JSON para evitar notación científica indistinguible', () => {
    expect(() => parseServerInteger(2000, 'Campo')).toThrow();
  });
});

describe('validacion de unidad de cantidad', () => {
  it('acepta solamente GR y AP', () => {
    expect(parseServerQuantityUnit('GR')).toBe('GR');
    expect(parseServerQuantityUnit('AP')).toBe('AP');
    expect(validateClientQuantityUnit('GR')).toEqual({ ok: true, value: 'GR' });
    expect(validateClientQuantityUnit('AP')).toEqual({ ok: true, value: 'AP' });
  });

  it.each(['', 'gr', 'ap', 'KG', 'tiros', null, 1])('rechaza %s', (value) => {
    expect(() => parseServerQuantityUnit(value)).toThrow();
    expect(validateClientQuantityUnit(value).ok).toBe(false);
  });
});
