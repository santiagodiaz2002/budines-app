import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  RESERVED_OWNER_USERNAMES,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH
} from './constants.js';
import { ApiError } from './http.js';

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const encoder = new TextEncoder();

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
