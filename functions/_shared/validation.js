import {
  MAX_INTEGER_DIGITS,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  RESERVED_OWNER_USERNAMES,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH
} from './constants.js';
import { ApiError } from './http.js';

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]{16,120}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const QUANTITY_UNITS = new Set(['GR', 'AP']);
const encoder = new TextEncoder();

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

export function parseQuantityUnit(value = 'GR') {
  if (typeof value !== 'string' || !QUANTITY_UNITS.has(value)) {
    throw new ApiError(400, 'invalid_quantity_unit', 'La unidad debe ser GR o AP.');
  }

  return value;
}

export function validateIdempotencyKey(value) {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ApiError(400, 'invalid_idempotency_key', 'La clave de idempotencia no es válida.');
  }
  return value;
}

export function normalizeUsername(value) {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'invalid_username', 'El nombre de usuario es obligatorio.');
  }

  if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) {
    throw new ApiError(
      400,
      'invalid_username',
      `El nombre de usuario debe tener entre ${USERNAME_MIN_LENGTH} y ${USERNAME_MAX_LENGTH} caracteres.`
    );
  }

  if (!USERNAME_PATTERN.test(value)) {
    throw new ApiError(400, 'invalid_username', 'Usá letras, números, punto, guion o guion bajo, sin espacios.');
  }

  return value.toLowerCase();
}

export function parseDisplayUsername(value) {
  normalizeUsername(value);
  return value;
}

export function validateRegistrationUsername(value) {
  const usernameNormalized = normalizeUsername(value);
  if (RESERVED_OWNER_USERNAMES.includes(usernameNormalized)) {
    throw new ApiError(409, 'username_unavailable', 'Ese nombre de usuario no está disponible.');
  }

  return {
    usernameNormalized,
    displayName: parseDisplayUsername(value)
  };
}

export function validateLoginUsername(value) {
  try {
    return normalizeUsername(value);
  } catch {
    throw new ApiError(401, 'invalid_credentials', 'Nombre de usuario o contraseña incorrectos.');
  }
}

export function validateNewPassword(value) {
  assertPasswordText(value, { generic: false });

  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(400, 'invalid_password', `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  return value;
}

export function validateLoginPassword(value) {
  try {
    return assertPasswordText(value, { generic: true });
  } catch (error) {
    if (error.code === 'password_too_long') {
      throw error;
    }
    throw new ApiError(401, 'invalid_credentials', 'Nombre de usuario o contraseña incorrectos.');
  }
}

function assertPasswordText(value, { generic }) {
  if (typeof value !== 'string') {
    if (generic) {
      throw new ApiError(401, 'invalid_credentials', 'Nombre de usuario o contraseña incorrectos.');
    }
    throw new ApiError(400, 'invalid_password', 'La contraseña es obligatoria.');
  }

  const byteLength = encoder.encode(value).length;
  if (byteLength > MAX_PASSWORD_BYTES) {
    throw new ApiError(400, 'password_too_long', 'La contraseña supera el largo máximo permitido.');
  }

  if (value.length === 0) {
    if (generic) {
      throw new ApiError(401, 'invalid_credentials', 'Nombre de usuario o contraseña incorrectos.');
    }
    throw new ApiError(400, 'invalid_password', 'La contraseña es obligatoria.');
  }

  return value;
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
