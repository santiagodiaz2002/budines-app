PRAGMA foreign_keys = ON;

-- Las filas históricas permanecen en records con sus unidades GR/AP.
-- Las operaciones nuevas usan este esquema para admitir ventas NORM/GEN
-- y retiros sin reconstruir la tabla histórica referenciada por bajas lógicas.
CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  user_id TEXT NOT NULL,
  quantity INTEGER,
  quantity_unit TEXT,
  amount_ars INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'activo',
  commercial_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  voided_by_user_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'web',
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (voided_by_user_id) REFERENCES users(id),
  CHECK (type IN ('venta', 'retiro')),
  CHECK (status IN ('activo', 'anulado')),
  CHECK (typeof(amount_ars) = 'integer' AND amount_ars > 0),
  CHECK (length(idempotency_key) BETWEEN 16 AND 120),
  CHECK (source = 'web'),
  CHECK (
    (
      type = 'venta'
      AND typeof(quantity) = 'integer'
      AND quantity > 0
      AND quantity_unit IN ('NORM', 'GEN')
    )
    OR
    (
      type = 'retiro'
      AND quantity IS NULL
      AND quantity_unit IS NULL
    )
  ),
  CHECK (
    (status = 'activo' AND voided_at IS NULL AND voided_by_user_id IS NULL)
    OR
    (status = 'anulado' AND voided_at IS NOT NULL AND voided_by_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_operations_created_at ON operations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operations_commercial_date ON operations(commercial_date DESC);
CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status);
CREATE INDEX IF NOT EXISTS idx_operations_user_id ON operations(user_id);
