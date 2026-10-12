import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

function worker() {
  const handlers = {};
  const source = readFileSync('public/sw.js', 'utf8');
  const sandbox = {
    URL,
    self: { location: { origin: 'https://budines.test' }, addEventListener: (name, handler) => { handlers[name] = handler; } }
  };
  runInNewContext(`${source}\nglobalThis.assets = SHELL_ASSETS;`, sandbox);
  return { sandbox, handlers };
}

it('precache incluye cada dependencia real del HTML y los módulos importados', () => {
  const { sandbox } = worker();
  const assets = new Set(sandbox.assets);
  const visited = new Set();
  function inspect(url) {
    if (visited.has(url)) return;
    visited.add(url);
    expect(assets.has(url), `Falta ${url}`).toBe(true);
    const path = new URL(url, 'https://budines.test').pathname;
    const source = readFileSync(`public${path === '/' ? '/index.html' : path}`, 'utf8');
    if (path.endsWith('.js')) {
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const dependency = new URL(match[1], `https://budines.test${url}`);
        inspect(dependency.pathname + dependency.search);
      }
    }
  }
  const html = readFileSync('public/index.html', 'utf8');
  for (const match of html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) inspect(match[1]);
});

it('navegación offline devuelve la raíz no redirigida y nunca guarda APIs', async () => {
  const { sandbox, handlers } = worker();
  const home = new Response('shell');
  sandbox.caches = { open: async () => ({ match: async key => { expect(key).toBe('/'); return home; } }) };
  sandbox.fetch = async () => { throw new TypeError('offline'); };
  let response;
  handlers.fetch({ request: { url: 'https://budines.test/ruta', method: 'GET', mode: 'navigate' }, respondWith: result => { response = result; } });
  expect(await response).toBe(home);
  handlers.fetch({ request: { url: 'https://budines.test/api/chat', method: 'GET' }, respondWith: result => { response = result; } });
  await expect(response).rejects.toThrow('offline');
});

it('actualizar el shell elimina versiones anteriores y conserva caches ajenos', async () => {
  const { sandbox, handlers } = worker();
  const deleted = [];
  sandbox.caches = {
    keys: async () => ['budines-shell-v36-offline-chat', 'budines-shell-v37-tools-only', 'otra-app'],
    delete: async key => { deleted.push(key); return true; }
  };
  let claimed = false;
  sandbox.self.clients = { claim: async () => { claimed = true; } };
  let activation;
  handlers.activate({ waitUntil: promise => { activation = promise; } });
  await activation;
  expect(deleted).toEqual(['budines-shell-v36-offline-chat', 'budines-shell-v37-tools-only']);
  expect(claimed).toBe(true);
});
