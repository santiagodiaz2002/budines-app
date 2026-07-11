import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const requiredFiles = [
  'package.json',
  'wrangler.jsonc',
  '.gitignore',
  '.dev.vars.example',
  'README.md',
  'AGENTS.md',
  'migrations/0001_initial.sql',
  'public/index.html',
  'public/styles.css',
  'public/manifest.webmanifest',
  'public/sw.js',
  'public/_headers',
  'functions/api/activate.js',
  'functions/api/session.js',
  'functions/api/logout.js',
  'functions/api/records/index.js',
  'functions/api/summary.js',
  'functions/api/health.js'
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

const migration = readIfExists('migrations/0001_initial.sql');
for (const forbidden of [' REAL ', '\nREAL ', ' REAL\n']) {
  if (migration.includes(forbidden)) {
    failures.push('la migración usa REAL');
  }
}

if (!migration.includes("amount_ars) = 'integer'") || !migration.includes('grams IS NULL')) {
  failures.push('la migración no evidencia restricciones enteras/nulos esperadas');
}

const frontendFiles = collectFiles('public/js').filter((file) => file.endsWith('.js'));
for (const file of frontendFiles) {
  const content = readFileSync(file, 'utf8');
  if (content.includes('localStorage')) {
    failures.push(`${file} usa localStorage`);
  }
  if (content.includes('innerHTML')) {
    failures.push(`${file} usa innerHTML`);
  }
  if (content.includes('65000')) {
    failures.push(`${file} contiene una suma inicial artificial`);
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
