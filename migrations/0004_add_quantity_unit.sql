PRAGMA foreign_keys = ON;

ALTER TABLE records
ADD COLUMN quantity_unit TEXT NOT NULL DEFAULT 'GR'
CHECK (quantity_unit IN ('GR', 'AP'));
