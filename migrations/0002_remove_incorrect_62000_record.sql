PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS record_deletions (
  record_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL,
  deleted_by_user_id TEXT,
  reason TEXT NOT NULL,
  FOREIGN KEY (record_id) REFERENCES records(id),
  FOREIGN KEY (deleted_by_user_id) REFERENCES users(id),
  CHECK (length(record_id) BETWEEN 1 AND 120),
  CHECK (deleted_by_user_id IS NULL OR deleted_by_user_id IN ('santi', 'leandro')),
  CHECK (reason IN ('incorrect_initial_balance', 'user_deleted'))
);

CREATE INDEX IF NOT EXISTS idx_record_deletions_deleted_at ON record_deletions(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_record_deletions_deleted_by ON record_deletions(deleted_by_user_id);

INSERT OR IGNORE INTO record_deletions (
  record_id,
  deleted_at,
  deleted_by_user_id,
  reason
)
SELECT
  id,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL,
  'incorrect_initial_balance'
FROM records
WHERE id = 'saldo-inicial-ars-62000'
  AND type = 'saldo_inicial'
  AND amount_ars = 62000
  AND source = 'seed';
