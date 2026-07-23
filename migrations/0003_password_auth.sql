PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  username_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_algorithm TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'common',
  can_access_budines INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT,
  CHECK (length(id) BETWEEN 3 AND 80),
  CHECK (length(username_normalized) BETWEEN 3 AND 30),
  CHECK (username_normalized NOT GLOB '*[^a-z0-9._-]*'),
  CHECK (length(display_name) BETWEEN 3 AND 30),
  CHECK (length(password_hash) = 64),
  CHECK (length(password_salt) = 64),
  CHECK (password_algorithm = 'PBKDF2-HMAC-SHA-256'),
  CHECK (typeof(password_iterations) = 'integer' AND password_iterations >= 600000),
  CHECK (role IN ('owner', 'common')),
  CHECK (can_access_budines IN (0, 1)),
  CHECK ((role = 'owner' AND can_access_budines = 1) OR (role = 'common' AND can_access_budines = 0)),
  CHECK (disabled_at IS NULL OR disabled_at >= created_at)
);

CREATE TABLE IF NOT EXISTS app_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES app_users(id),
  CHECK (length(token_hash) = 64),
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL,
  CHECK (length(key) BETWEEN 1 AND 180),
  CHECK (purpose IN ('login', 'register')),
  CHECK (typeof(attempts) = 'integer' AND attempts >= 0),
  CHECK (blocked_until IS NULL OR blocked_until >= window_started_at)
);

CREATE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username_normalized);
CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users(role);
CREATE INDEX IF NOT EXISTS idx_app_sessions_token_hash ON app_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user_expires ON app_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_app_sessions_expires ON app_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated ON auth_rate_limits(updated_at);

UPDATE sessions
SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE revoked_at IS NULL;
