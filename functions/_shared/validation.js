import { ALLOWED_USERS, MAX_INTEGER_DIGITS } from './constants.js';
import { ApiError } from './http.js';

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]{16,120}$/;

export function parsePositiveIntegerText(rawValue, label) {
  if (typeof rawValue !== 'string') {
    throw new ApiError(400, 'invalid_integer', `${label} debe enviarse como texto numérico entero.`);
  }

  if (rawValue.length === 0) {
    throw new ApiError(400, 'required_field', `${label} es obligatorio.`);
  }

  if (rawValue.length > MAX_INTEGER_DIGITS) {
    throw new ApiError(400, 'integer_too_long', `${label} supera el largo máximo permitido.`);
  }

  if (!POSITIVE_INTEGER_PATTERN.test(rawValue)) {
    throw new ApiError(400, 'invalid_integer', `${label} debe ser un entero positivo sin separadores ni decimales.`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ApiError(400, 'invalid_integer', `${label} debe ser un entero positivo seguro.`);
  }

  return value;
}

export function validateIdempotencyKey(value) {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ApiError(400, 'invalid_idempotency_key', 'La clave de idempotencia no es válida.');
  }
  return value;
}

export function resolveActivationUserId(name) {
  if (typeof name !== 'string') {
    throw new ApiError(400, 'invalid_user', 'El nombre del usuario es obligatorio.');
  }

  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    throw new ApiError(400, 'invalid_user', 'El nombre del usuario es obligatorio.');
  }

  if (!Object.hasOwn(ALLOWED_USERS, normalized)) {
    throw new ApiError(401, 'invalid_credentials', 'Credenciales inválidas.');
  }

  return normalized;
}

export function parsePagination(searchParams) {
  const limitRaw = searchParams.get('limit');
  const offsetRaw = searchParams.get('offset');
  const limit = parseOptionalBoundedInteger(limitRaw, 30, 1, 50, 'limit');
  const offset = parseOptionalBoundedInteger(offsetRaw, 0, 0, 1000000, 'offset');

  return { limit, offset };
}

function parseOptionalBoundedInteger(raw, defaultValue, min, max, label) {
  if (raw === null || raw === '') {
    return defaultValue;
  }

  if (!/^[0-9]+$/.test(raw)) {
    throw new ApiError(400, 'invalid_pagination', `${label} debe ser un entero.`);
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError(400, 'invalid_pagination', `${label} está fuera de rango.`);
  }

  return value;
}
