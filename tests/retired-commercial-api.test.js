import { describe, expect, it } from 'vitest';
import { onRequest as summary } from '../functions/api/summary.js';
import { onRequest as ownerSummary } from '../functions/api/owner-summary.js';
import { onRequest as records } from '../functions/api/records/index.js';
import { onRequest as voidRecord } from '../functions/api/records/[id]/void.js';

const endpoints = [
  ['summary', summary],
  ['owner-summary', ownerSummary],
  ['records', records],
  ['records/example/void', voidRecord]
];

describe('rutas comerciales retiradas', () => {
  it.each(endpoints)('%s rechaza todos los métodos sin acceder a sesión, cuerpo ni DB', async (path, endpoint) => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const context = {
        request: new Request(`https://budines.test/api/${path}`, { method }),
        env: new Proxy({}, {
          get() {
            throw new Error(`La ruta retirada no debe usar DB ni configuración (${method}).`);
          }
        })
      };
      const response = await endpoint(context);
      expect(response.status).toBe(410);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({
        ok: false,
        error: { code: 'section_removed', message: 'Esta sección fue eliminada.' }
      });
    }
  });
});
