const arsFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0
});

const numberFormatter = new Intl.NumberFormat('es-AR', {
  maximumFractionDigits: 0
});

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
});

export function formatArs(value) {
  return arsFormatter.format(value);
}

export function formatInteger(value) {
  return numberFormatter.format(value);
}

export function formatCommercialDate(dateValue) {
  if (!dateValue) {
    return 'Fecha sin informar';
  }

  const date = new Date(`${dateValue}T12:00:00-03:00`);
  return dateFormatter.format(date);
}

export function formatRecordType(type) {
  if (type === 'saldo_inicial') return 'Saldo inicial';
  return type === 'retiro' ? 'Retiro' : 'Venta';
}

export function formatRecordStatus(status) {
  return status === 'anulado' ? 'Anulado' : 'Activo';
}
