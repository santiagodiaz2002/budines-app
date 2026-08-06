PRAGMA foreign_keys = ON;

-- Conserva la frontera física del período cerrado. El rowid máximo existente
-- hace seguro un reintento: los registros creados después de la primera
-- aplicación quedan fuera de la frontera y siguen contando normalmente.
INSERT OR IGNORE INTO config (key, value)
SELECT
  'profit_period_closed_through_record_rowid',
  CAST(COALESCE(MAX(rowid), 0) AS TEXT)
FROM records;

INSERT INTO config (key, value)
VALUES ('initial_investment_ars', '0')
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- El esquema actual solo permite user_deleted o incorrect_initial_balance.
-- user_deleted sin actor identifica de forma consistente este cierre administrativo.
INSERT OR IGNORE INTO record_deletions (
  record_id,
  deleted_at,
  deleted_by_user_id,
  reason
)
SELECT
  r.id,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL,
  'user_deleted'
FROM records r
LEFT JOIN record_deletions rd ON rd.record_id = r.id
WHERE r.status = 'activo'
  AND rd.record_id IS NULL
  AND r.rowid <= CAST((
    SELECT value
    FROM config
    WHERE key = 'profit_period_closed_through_record_rowid'
  ) AS INTEGER);
