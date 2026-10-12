-- Cancionero compartido. No modifica cuentas, sesiones, chat ni tablas retiradas.
CREATE TABLE IF NOT EXISTS songbook_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS songbook_songs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  blocks_json TEXT NOT NULL CHECK (json_valid(blocks_json)),
  folder_id TEXT REFERENCES songbook_folders(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- El registro sobrevive a la eliminación: una copia local antigua no revive la canción.
CREATE TABLE IF NOT EXISTS songbook_imports (
  import_key TEXT PRIMARY KEY CHECK (length(import_key) = 64),
  song_id TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_songbook_songs_folder ON songbook_songs(folder_id);
