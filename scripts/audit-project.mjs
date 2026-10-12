import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const requiredFiles = [
  'package.json',
  'wrangler.jsonc',
  '.gitignore',
  '.dev.vars.example',
  'README.md',
  'AGENTS.md',
  'database/schema.sql',
  'migrations/0011_retire_accounting.sql',
  'migrations/0012_shared_songbook.sql',
  'public/index.html',
  'public/styles.css',
  'public/manifest.webmanifest',
  'public/sw.js',
  'public/_headers',
  'functions/api/activate.js',
  'functions/api/login.js',
  'functions/api/register.js',
  'functions/api/session.js',
  'functions/api/logout.js',
  'functions/api/records/index.js',
  'functions/api/summary.js',
  'functions/api/owner-summary.js',
  'functions/api/records/[id]/void.js',
  'functions/api/chat.js',
  'functions/api/songbook.js',
  'functions/api/health.js',
  'scripts/seed-owners.mjs'
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    failures.push(`falta ${file}`);
  }
}

const gitignore = readIfExists('.gitignore');
if (!gitignore.includes('.dev.vars')) {
  failures.push('.dev.vars no está ignorado');
}

const schema = readIfExists('database/schema.sql');
const allowedTables = new Set(['app_users', 'app_sessions', 'auth_rate_limits', 'chat_messages', 'songbook_songs', 'songbook_folders', 'songbook_imports']);
const bootstrapTables = [...schema.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/gi)]
  .map((match) => match[1]);
if (bootstrapTables.length !== allowedTables.size || bootstrapTables.some((table) => !allowedTables.has(table))) {
  failures.push('el esquema inicial debe contener solo cuentas, sesiones, límites de autenticación, chat y cancionero');
}
for (const retiredModule of ['d1-repository.js', 'records-service.js', 'summary.js']) {
  if (existsSync(join('functions/_shared', retiredModule))) {
    failures.push(`sigue presente el módulo comercial ${retiredModule}`);
  }
}

const frontendFiles = collectFiles('public/js').filter((file) => file.endsWith('.js'));
const localStorageAllowed = new Set([
  'public\\js\\truco.js',
  'public\\js\\metronome.js',
  'public\\js\\metronome-editor.js',
  'public\\js\\local-storage.js',
  'public\\js\\songbook-client.js',
  'public/js/truco.js',
  'public/js/metronome.js',
  'public/js/metronome-editor.js',
  'public/js/local-storage.js',
  'public/js/songbook-client.js'
]);
for (const file of frontendFiles) {
  const content = readFileSync(file, 'utf8');
  if (content.includes('localStorage') && !localStorageAllowed.has(file)) {
    failures.push(`${file} usa localStorage`);
  }
  if (content.includes('innerHTML')) {
    failures.push(`${file} usa innerHTML`);
  }
}

const versionedFiles = collectFiles('.').filter((file) => !isIgnoredForAudit(file));
const suspiciousSecretPatterns = [
  /budines_session=[a-f0-9]{64}/i
];

for (const file of versionedFiles) {
  if (!isTextFile(file)) {
    continue;
  }

  const content = readFileSync(file, 'utf8');
  for (const pattern of suspiciousSecretPatterns) {
    if (pattern.test(content)) {
      failures.push(`${file} contiene un patrón sensible`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log('audit ok');

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function collectFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  const stat = statSync(root);
  if (stat.isFile()) {
    return [root];
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(path);
    }
    return [path];
  });
}

function isIgnoredForAudit(file) {
  return (
    file.startsWith('node_modules') ||
    file.startsWith('.git') ||
    file.startsWith('.wrangler') ||
    file === '.dev.vars' ||
    file === 'package-lock.json'
  );
}

function isTextFile(file) {
  return /\.(js|mjs|json|jsonc|html|css|md|sql|txt|webmanifest|example|gitignore|svg)$/.test(file);
}
