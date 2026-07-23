export const MAX_INTEGER_DIGITS = 12;
export const QUANTITY_UNITS = Object.freeze(['GR', 'AP']);

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

export function parsePositiveIntegerText(rawValue, label) {
  if (typeof rawValue !== 'string') {
    return {
      ok: false,
      message: `${label} debe ser un entero positivo.`
    };
  }

  if (rawValue.length === 0) {
    return {
      ok: false,
      message: `${label} es obligatorio.`
    };
  }

  if (rawValue.length > MAX_INTEGER_DIGITS) {
    return {
      ok: false,
      message: `${label} supera el largo máximo permitido.`
    };
  }

  if (!POSITIVE_INTEGER_PATTERN.test(rawValue)) {
    return {
      ok: false,
      message: `${label} debe ser un entero positivo sin separadores ni decimales.`
    };
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 1) {
    return {
      ok: false,
      message: `${label} debe ser un entero positivo válido.`
    };
  }

  return {
    ok: true,
    value
  };
}

export function validateQuantityUnit(rawValue) {
  if (!QUANTITY_UNITS.includes(rawValue)) {
    return {
      ok: false,
      message: 'La unidad debe ser GR o AP.'
    };
  }

  return {
    ok: true,
    value: rawValue
  };
}

export function validateSaleFields(gramsRaw, quantityUnitRaw, amountRaw) {
  const grams = parsePositiveIntegerText(gramsRaw, 'Cantidad');
  if (!grams.ok) {
    return {
      ok: false,
      field: 'grams',
      message: grams.message
    };
  }

  const quantityUnit = validateQuantityUnit(quantityUnitRaw);
  if (!quantityUnit.ok) {
    return {
      ok: false,
      field: 'quantityUnit',
      message: quantityUnit.message
    };
  }

  const amount = parsePositiveIntegerText(amountRaw, 'Importe total');
  if (!amount.ok) {
    return {
      ok: false,
      field: 'amount',
      message: amount.message
    };
  }

  return {
    ok: true,
    grams: grams.value,
    quantityUnit: quantityUnit.value,
    amountArs: amount.value
  };
}
