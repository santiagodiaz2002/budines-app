-- Reinicio contable reconciliado contra D1 el 2026-09-03.
--
-- Las fronteras se derivan de IDs reales, no de una fecha diaria. Todos los
-- movimientos con rowid posterior quedan incluidos automáticamente, incluso
-- si fueron creados entre el snapshot y la aplicación de esta migración.

INSERT INTO accounting_resets (
  id,
  records_boundary_id,
  records_through_rowid,
  operations_boundary_id,
  operations_through_rowid,
  applied_at
)
SELECT
  'profit-period-2026-09-03',
  r.id,
  r.rowid,
  o.id,
  o.rowid,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM records r
JOIN operations o
  ON o.id = 'a11e8f68-411e-460f-aaac-ce98d2d3d7f7'
WHERE r.id = '635f4977-5a33-45d2-b1e9-7d01619c23e9'
ON CONFLICT(id) DO NOTHING;

INSERT OR IGNORE INTO accounting_exclusions (
  storage,
  movement_id,
  reset_id,
  excluded_at,
  reason
)
SELECT
  'records',
  r.id,
  ar.id,
  ar.applied_at,
  'accounting_reset'
FROM records r
JOIN accounting_resets ar ON ar.id = 'profit-period-2026-09-03'
WHERE r.rowid <= ar.records_through_rowid
  AND r.id NOT IN (
    '7067f4af-946c-4060-b528-02e61e9cba19',
    'de2cfc16-2bc7-4e10-a864-b96e9581ca0d',
    'd9c2c0bc-a71b-41a6-85ee-1f659c1eca19',
    'b1c6d5da-7df5-4940-94dd-7da92641384f',
    '635f4977-5a33-45d2-b1e9-7d01619c23e9'
  );

INSERT OR IGNORE INTO accounting_exclusions (
  storage,
  movement_id,
  reset_id,
  excluded_at,
  reason
)
SELECT
  'operations',
  o.id,
  ar.id,
  ar.applied_at,
  'accounting_reset'
FROM operations o
JOIN accounting_resets ar ON ar.id = 'profit-period-2026-09-03'
WHERE o.rowid <= ar.operations_through_rowid
  AND o.id NOT IN (
    'be12128b-9f3d-4773-ab60-f8169c3b21c9',
    'f5a7fb17-5967-45b0-af86-7604e5bd145b',
    'bf888f1a-385e-4d30-a136-0a3275f64b9d',
    '59a526ba-3e85-4917-8c5c-f035d4e95932'
  );
