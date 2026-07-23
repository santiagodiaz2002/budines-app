export const APP_NAME = 'Budines';
export const SESSION_COOKIE_NAME = 'budines_session';
export const DEFAULT_SESSION_DAYS = 30;
export const MAX_SESSION_DAYS = 90;
export const MAX_JSON_BODY_BYTES = 4096;
export const MAX_INTEGER_DIGITS = 12;
export const DEFAULT_RECORD_LIMIT = 30;
export const MAX_RECORD_LIMIT = 50;
export const PASSWORD_ALGORITHM = 'PBKDF2-HMAC-SHA-256';
export const PASSWORD_ITERATIONS = 600000;
export const PBKDF2_MAX_ITERATIONS_PER_DERIVE = 100000;
export const PASSWORD_HASH_BYTES = 32;
export const PASSWORD_SALT_BYTES = 32;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 1024;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const OWNER_ROLE = 'owner';
export const COMMON_ROLE = 'common';
export const LOGIN_MAX_ATTEMPTS = 10;
export const REGISTER_MAX_ATTEMPTS = 8;
export const AUTH_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
export const AUTH_RATE_LIMIT_BLOCK_SECONDS = 15 * 60;

export const ALLOWED_USERS = Object.freeze({
  santi: {
    id: 'santi',
    usernameNormalized: 'santi',
    displayName: 'Santi',
    role: OWNER_ROLE,
    canAccessBudines: true
  },
  leandro: {
    id: 'leandro',
    usernameNormalized: 'leandro',
    displayName: 'Leandro',
    role: OWNER_ROLE,
    canAccessBudines: true
  }
});

export const RESERVED_OWNER_USERNAMES = Object.freeze(Object.keys(ALLOWED_USERS));
