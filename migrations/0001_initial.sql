PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(key) BETWEEN 1 AND 80)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (id IN ('santi', 'leandro')),
  CHECK (display_name IN ('Santi', 'Leandro')),
  CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  CHECK (length(token_hash) = 64),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  user_id TEXT,
  grams INTEGER,
  amount_ars INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'activo',
  commercial_date TEXT,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  voided_by_user_id TEXT,
  idempotency_key TEXT UNIQUE,
  source TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (voided_by_user_id) REFERENCES users(id),
  CHECK (type IN ('saldo_inicial', 'venta')),
  CHECK (status IN ('activo', 'anulado')),
  CHECK (typeof(amount_ars) = 'integer' AND amount_ars > 0),
  CHECK (grams IS NULL OR (typeof(grams) = 'integer' AND grams > 0)),
  CHECK (source IN ('seed', 'web')),
  CHECK (
    (
      type = 'saldo_inicial'
      AND user_id IS NULL
      AND grams IS NULL
      AND commercial_date IS NULL
      AND status = 'activo'
      AND voided_at IS NULL
      AND voided_by_user_id IS NULL
      AND idempotency_key IS NULL
      AND source = 'seed'
    )
    OR
    (
      type = 'venta'
      AND user_id IS NOT NULL
      AND grams IS NOT NULL
      AND idempotency_key IS NOT NULL
      AND length(idempotency_key) BETWEEN 16 AND 120
      AND source = 'web'
    )
  ),
  CHECK (
    (status = 'activo' AND voided_at IS NULL AND voided_by_user_id IS NULL)
    OR
    (status = 'anulado' AND voided_at IS NOT NULL AND voided_by_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_commercial_date ON records(commercial_date DESC);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);

INSERT INTO config (key, value)
VALUES ('initial_investment_ars', '120000')
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO users (id, display_name, active)
VALUES
  ('santi', 'Santi', 1),
  ('leandro', 'Leandro', 1)
ON CONFLICT(id) DO UPDATE SET
  display_name = excluded.display_name,
  active = excluded.active;

INSERT OR IGNORE INTO records (
  id,
  type,
  user_id,
  grams,
  amount_ars,
  status,
  commercial_date,
  created_at,
  voided_at,
  voided_by_user_id,
  idempotency_key,
  source
)
VALUES
  (
    'saldo-inicial-ars-3000',
    'saldo_inicial',
    NULL,
    NULL,
    3000,
    'activo',
    NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    NULL,
    NULL,
    NULL,
    'seed'
  ),
  (
    'saldo-inicial-ars-62000',
    'saldo_inicial',
    NULL,
    NULL,
    62000,
    'activo',
    NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    NULL,
    NULL,
    NULL,
    'seed'
  );
