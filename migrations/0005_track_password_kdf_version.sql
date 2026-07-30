ALTER TABLE app_users
ADD COLUMN password_kdf_version INTEGER NOT NULL DEFAULT 1
CHECK (password_kdf_version IN (1, 2));
