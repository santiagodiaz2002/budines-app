-- Esquema persistente para separar el estado contable actual del historial.
-- Una fila activa cuenta salvo que aparezca en accounting_exclusions.

CREATE TABLE IF NOT EXISTS accounting_resets (
  id TEXT PRIMARY KEY,
  records_boundary_id TEXT NOT NULL,
  records_through_rowid INTEGER NOT NULL,
  operations_boundary_id TEXT NOT NULL,
  operations_through_rowid INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  CHECK (length(id) BETWEEN 1 AND 80),
  CHECK (length(records_boundary_id) BETWEEN 1 AND 120),
  CHECK (typeof(records_through_rowid) = 'integer' AND records_through_rowid > 0),
  CHECK (length(operations_boundary_id) BETWEEN 1 AND 120),
  CHECK (typeof(operations_through_rowid) = 'integer' AND operations_through_rowid > 0)
);

CREATE TABLE IF NOT EXISTS accounting_exclusions (
  storage TEXT NOT NULL,
  movement_id TEXT NOT NULL,
  reset_id TEXT NOT NULL,
  excluded_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (storage, movement_id),
  FOREIGN KEY (reset_id) REFERENCES accounting_resets(id),
  CHECK (storage IN ('records', 'operations')),
  CHECK (length(movement_id) BETWEEN 1 AND 120),
  CHECK (reason = 'accounting_reset')
);

CREATE INDEX IF NOT EXISTS idx_accounting_exclusions_reset_id
ON accounting_exclusions(reset_id);
