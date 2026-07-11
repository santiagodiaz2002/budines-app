import { describe, expect, it } from 'vitest';
import { parsePositiveIntegerText as parseServerInteger } from '../functions/_shared/validation.js';
import { parsePositiveIntegerText as parseClientInteger } from '../public/js/validation.js';

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
