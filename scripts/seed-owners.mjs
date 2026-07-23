import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  PASSWORD_ALGORITHM,
  PASSWORD_ITERATIONS,
  PASSWORD_SALT_BYTES
} from '../functions/_shared/constants.js';
import { bytesToHex } from '../functions/_shared/crypto.js';
import { derivePbkdf2PasswordHash } from '../functions/_shared/password-kdf.js';

const encoder = new TextEncoder();
const cryptoImpl = globalThis.crypto || webcrypto;
const owners = [
  { id: 'santi', usernameNormalized: 'santi', displayName: 'Santi' },
  { id: 'leandro', usernameNormalized: 'leandro', displayName: 'Leandro' }
];

const args = new Set(process.argv.slice(2));
const remote = args.has('--remote');
const local = args.has('--local') || !remote;
const database = readArg('--database') || 'budines';
const password = await readPassword();

validatePassword(password);

const now = new Date().toISOString();
const rows = [];
for (const owner of owners) {
  const saltBytes = new Uint8Array(PASSWORD_SALT_BYTES);
  cryptoImpl.getRandomValues(saltBytes);
  const saltHex = bytesToHex(saltBytes);
  const hashHex = await derivePasswordHash(password, saltHex);
  rows.push({ ...owner, saltHex, hashHex });
}

const sql = `
PRAGMA foreign_keys = ON;

${rows
  .map(
    (row) => `
INSERT INTO app_users (
  id,
  username_normalized,
  display_name,
  password_hash,
  password_salt,
  password_algorithm,
  password_iterations,
  role,
  can_access_budines,
  created_at,
  updated_at,
  disabled_at
)
VALUES (
  ${sqlQuote(row.id)},
  ${sqlQuote(row.usernameNormalized)},
  ${sqlQuote(row.displayName)},
  ${sqlQuote(row.hashHex)},
  ${sqlQuote(row.saltHex)},
  ${sqlQuote(PASSWORD_ALGORITHM)},
  ${PASSWORD_ITERATIONS},
  'owner',
  1,
  ${sqlQuote(now)},
  ${sqlQuote(now)},
  NULL
)
ON CONFLICT(username_normalized) DO UPDATE SET
  id = excluded.id,
  display_name = excluded.display_name,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt,
  password_algorithm = excluded.password_algorithm,
  password_iterations = excluded.password_iterations,
  role = 'owner',
  can_access_budines = 1,
  updated_at = excluded.updated_at,
  disabled_at = NULL;
`
  )
  .join('\n')}

UPDATE app_users
SET role = 'common',
    can_access_budines = 0,
    updated_at = ${sqlQuote(now)}
WHERE role = 'owner'
  AND username_normalized NOT IN ('santi', 'leandro');
`;

const tempDir = mkdtempSync(join(tmpdir(), 'budines-owner-seed-'));
const file = join(tempDir, 'seed.sql');

try {
  writeFileSync(file, sql, { encoding: 'utf8', mode: 0o600 });
  const modeArg = remote ? '--remote' : local ? '--local' : '--local';
  const result = spawnSync('npx', ['wrangler', 'd1', 'execute', database, modeArg, '--file', file], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.log(`Seed de cuentas iniciales completado en D1 ${remote ? 'remoto' : 'local'}.`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function readPassword() {
  if (process.env.BUDINES_OWNER_PASSWORD) {
    return process.env.BUDINES_OWNER_PASSWORD;
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    console.error('La contraseña inicial no cumple el largo mínimo.');
    process.exit(1);
  }

  if (encoder.encode(value).length > MAX_PASSWORD_BYTES) {
    console.error('La contraseña inicial supera el largo máximo permitido.');
    process.exit(1);
  }
}

async function derivePasswordHash(passwordText, saltHex) {
  return derivePbkdf2PasswordHash(cryptoImpl, encoder.encode(passwordText), saltHex, PASSWORD_ITERATIONS);
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
