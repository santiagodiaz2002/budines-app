import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['functions', 'public/js', 'scripts', 'tests'];
const files = roots.flatMap((root) => collectJsFiles(root));

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`syntax ok (${files.length} JS files)`);

function collectJsFiles(root) {
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return collectJsFiles(path);
      }
      return /\.(mjs|js)$/.test(entry.name) ? [path] : [];
    });
  } catch {
    return [];
  }
}
