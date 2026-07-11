export const APP_NAME = 'Budines';
export const SESSION_COOKIE_NAME = 'budines_session';
export const DEFAULT_SESSION_DAYS = 30;
export const MAX_SESSION_DAYS = 90;
export const MAX_JSON_BODY_BYTES = 4096;
export const MAX_INTEGER_DIGITS = 12;
export const DEFAULT_RECORD_LIMIT = 30;
export const MAX_RECORD_LIMIT = 50;

export const ALLOWED_USERS = Object.freeze({
  santi: {
    id: 'santi',
    displayName: 'Santi',
    activationSecretName: 'SANTI_ACTIVATION_CODE'
  },
  leandro: {
    id: 'leandro',
    displayName: 'Leandro',
    activationSecretName: 'LEANDRO_ACTIVATION_CODE'
  }
});
