-- Retiro definitivo de la contabilidad solicitado por el propietario.
-- Conserva cuentas, sesiones actuales, límites de autenticación y chat.
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS record_deletions;
DROP TABLE IF EXISTS accounting_exclusions;
DROP TABLE IF EXISTS operations;
DROP TABLE IF EXISTS records;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS accounting_resets;
DROP TABLE IF EXISTS config;
DROP TABLE IF EXISTS users;
