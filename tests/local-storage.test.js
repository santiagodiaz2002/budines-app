import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLocalStorageUser, scopedStorageKey, setLocalStorageUser } from '../public/js/local-storage.js?v=auth-20260723';
import { initTruco } from '../public/js/truco.js';

const html = readFileSync('public/index.html', 'utf8');
const TRUCO_KEY = 'budines.truco.v1';

let windowRef;

afterEach(() => {
  clearLocalStorageUser();
  vi.unstubAllGlobals();
  windowRef?.close();
});

describe('localStorage por usuario', () => {
  it('migra legacy una sola vez para un owner y no lo copia a comunes ni a todos los owners', () => {
    setupDom();
    windowRef.localStorage.setItem(TRUCO_KEY, '{"scores":{"nosotros":4,"ellos":2},"history":[]}');

    setLocalStorageUser(commonUser('comun'));
    expect(windowRef.localStorage.getItem(scopedStorageKey(TRUCO_KEY))).toBeNull();

    clearLocalStorageUser();
    setLocalStorageUser(ownerUser('santi'));
    const santiKey = scopedStorageKey(TRUCO_KEY);
    expect(JSON.parse(windowRef.localStorage.getItem(santiKey)).scores).toEqual({ nosotros: 4, ellos: 2 });

    clearLocalStorageUser();
    setLocalStorageUser(ownerUser('leandro'));
    expect(windowRef.localStorage.getItem(scopedStorageKey(TRUCO_KEY))).toBeNull();
    expect(windowRef.localStorage.getItem(TRUCO_KEY)).not.toBeNull();
  });

  it('Truco persiste puntaje en el namespace activo', () => {
    setupDom();
    setLocalStorageUser(commonUser('comun'));
    const scopedKey = scopedStorageKey(TRUCO_KEY);

    initTruco(undefined, { id: 'comun' });
    document.querySelector('[data-truco-team-target="nosotros"][data-truco-action="add"]').click();

    expect(JSON.parse(windowRef.localStorage.getItem(scopedKey)).scores.nosotros).toBe(1);
    expect(windowRef.localStorage.getItem(TRUCO_KEY)).toBeNull();
  });
});

function setupDom() {
  windowRef = new Window({ url: 'https://budines.test/' });
  windowRef.document.write(html);
  windowRef.document.close();
  vi.stubGlobal('window', windowRef);
  vi.stubGlobal('document', windowRef.document);
  vi.stubGlobal('localStorage', windowRef.localStorage);
  vi.stubGlobal('KeyboardEvent', windowRef.KeyboardEvent);
  vi.stubGlobal('MouseEvent', windowRef.MouseEvent);
}

function ownerUser(id) {
  return {
    id,
    capabilities: {
      canAccessBudines: true
    }
  };
}

function commonUser(id) {
  return {
    id,
    capabilities: {
      canAccessBudines: false
    }
  };
}
