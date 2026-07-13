import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOOL_TABS, initToolNavigation } from '../public/js/navigation.js';

let windowRef;

afterEach(() => {
  vi.unstubAllGlobals();
  windowRef?.close();
});

describe('navegacion inferior de herramientas', () => {
  it('expone exactamente cuatro pestañas y Budines inicia activa', () => {
    setupDom();

    const nav = initToolNavigation();
    const tabs = [...document.querySelectorAll('[data-tool-tab]')];

    expect(tabs).toHaveLength(4);
    expect(tabs.map((tab) => tab.dataset.toolTab)).toEqual(TOOL_TABS);
    expect(tabs.map((tab) => tab.textContent.trim())).toEqual(['Budines', 'Truco', 'Metrónomo', 'Afinador']);
    expect(nav.currentTab).toBe('budines');
    expect(document.body.dataset.activeTool).toBe('budines');
    expect(document.querySelector('#budines-tool').hidden).toBe(false);
    expect(document.querySelector('#truco-tool').hidden).toBe(true);
    expect(document.querySelector('#tab-budines').getAttribute('aria-selected')).toBe('true');
  });

  it('cambia pestaña sin recargar y mantiene estado accesible', () => {
    setupDom();
    initToolNavigation();

    document.querySelector('#tab-tuner').click();

    expect(document.querySelector('#budines-tool').hidden).toBe(true);
    expect(document.querySelector('#tuner-tool').hidden).toBe(false);
    expect(document.body.dataset.activeTool).toBe('tuner');
    expect(document.querySelector('#tab-tuner').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('#tab-budines').getAttribute('aria-selected')).toBe('false');
  });

  it('acepta clicks sobre el icono interno de la pestaña', () => {
    setupDom();
    initToolNavigation();

    document.querySelector('#tab-truco svg path').dispatchEvent(new windowRef.MouseEvent('click', { bubbles: true }));

    expect(document.querySelector('#truco-tool').hidden).toBe(false);
    expect(document.querySelector('#tab-truco').getAttribute('aria-selected')).toBe('true');
  });
});

function setupDom() {
  const html = readFileSync('public/index.html', 'utf8');
  windowRef = new Window({ url: 'https://budines.test/' });
  windowRef.document.write(html);
  windowRef.document.close();
  vi.stubGlobal('window', windowRef);
  vi.stubGlobal('document', windowRef.document);
  vi.stubGlobal('KeyboardEvent', windowRef.KeyboardEvent);
}
