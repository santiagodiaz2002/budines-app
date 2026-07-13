import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  applyScoreChange,
  createDefaultTrucoState,
  createStickPattern,
  getTrucoWinner,
  initTruco,
  sanitizeTrucoState,
  undoScoreChange
} from '../public/js/truco.js';

let windowRef;

afterEach(() => {
  vi.unstubAllGlobals();
  windowRef?.close();
});

describe('Truco a 30', () => {
  it('suma, resta y respeta limites 0 y 30', () => {
    let state = createDefaultTrucoState();
    state = applyScoreChange(state, 'nosotros', -1);
    expect(state.scores.nosotros).toBe(0);

    for (let index = 0; index < 31; index += 1) {
      state = applyScoreChange(state, 'nosotros', 1);
    }
    expect(state.scores.nosotros).toBe(30);
    expect(getTrucoWinner(state.scores)).toBe('Nosotros');

    state = applyScoreChange(state, 'nosotros', -1);
    expect(state.scores.nosotros).toBe(29);
    expect(getTrucoWinner(state.scores)).toBeNull();
  });

  it('deshace el ultimo cambio', () => {
    let state = createDefaultTrucoState();
    state = applyScoreChange(state, 'ellos', 1);
    state = applyScoreChange(state, 'ellos', 1);

    expect(state.scores.ellos).toBe(2);
    state = undoScoreChange(state);
    expect(state.scores.ellos).toBe(1);
  });

  it('descarta datos corruptos y persiste cambios locales', () => {
    setupDom();
    window.localStorage.setItem('budines.truco.v1', '{"scores":{"nosotros":99,"ellos":0},"history":[]}');
    initTruco();

    expect(document.querySelector('[data-truco-team="nosotros"] [data-truco-score]').textContent).toBe('0');
    document.querySelector('[data-truco-team-target="nosotros"][data-truco-action="add"]').click();

    const stored = JSON.parse(window.localStorage.getItem('budines.truco.v1'));
    expect(stored.scores.nosotros).toBe(1);
  });

  it('renderiza los palitos con el asset limpio y decorativo', () => {
    setupDom();
    initTruco();

    for (let index = 0; index < 5; index += 1) {
      document.querySelector('[data-truco-team-target="nosotros"][data-truco-action="add"]').click();
    }

    const block = document.querySelector('[data-truco-team="nosotros"] [data-stick-block="1"]');
    const vertical = block.querySelectorAll('[data-stick="vertical"]');
    const diagonal = block.querySelectorAll('[data-stick="diagonal"]');
    const images = block.querySelectorAll('img');

    expect(vertical).toHaveLength(4);
    expect(diagonal).toHaveLength(1);
    expect([...images].every((image) => image.getAttribute('src') === '/media/joint-clean.png')).toBe(true);
    expect([...images].every((image) => image.getAttribute('alt') === '')).toBe(true);
  });

  it('cancela y confirma nueva partida con modal', () => {
    setupDom();
    initTruco();

    document.querySelector('[data-truco-team-target="nosotros"][data-truco-action="add"]').click();
    document.querySelector('#truco-reset').click();
    expect(document.querySelector('#truco-reset-dialog').hidden).toBe(false);

    document.querySelector('#truco-reset-cancel').click();
    expect(document.querySelector('[data-truco-team="nosotros"] [data-truco-score]').textContent).toBe('1');

    document.querySelector('#truco-reset').click();
    document.querySelector('#truco-reset-confirm').click();
    expect(document.querySelector('[data-truco-team="nosotros"] [data-truco-score]').textContent).toBe('0');
  });

  it.each([
    [0, []],
    [1, [{ vertical: 1, diagonal: false }]],
    [3, [{ vertical: 3, diagonal: false }]],
    [5, [{ vertical: 4, diagonal: true }]],
    [6, [{ vertical: 4, diagonal: true }, { vertical: 1, diagonal: false }]],
    [10, [{ vertical: 4, diagonal: true }, { vertical: 4, diagonal: true }]],
    [
      30,
      [
        { vertical: 4, diagonal: true },
        { vertical: 4, diagonal: true },
        { vertical: 4, diagonal: true },
        { vertical: 4, diagonal: true },
        { vertical: 4, diagonal: true },
        { vertical: 4, diagonal: true }
      ]
    ]
  ])('representa %i puntos con bloques de cinco correctos', (score, expected) => {
    expect(createStickPattern(score)).toEqual(expected);
  });

  it('sanitiza historial invalido sin perder puntajes validos', () => {
    const state = sanitizeTrucoState({
      scores: { nosotros: 4, ellos: 7 },
      history: [{ nope: true }]
    });

    expect(state.scores).toEqual({ nosotros: 4, ellos: 7 });
    expect(state.history).toEqual([]);
  });

  it('el asset derivado del joint conserva transparencia', async () => {
    const metadata = await sharp('public/media/joint-clean.png').metadata();

    expect(metadata.format).toBe('png');
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.width).toBeGreaterThan(450);
    expect(metadata.height).toBeGreaterThan(80);
  });
});

function setupDom() {
  const html = readFileSync('public/index.html', 'utf8');
  windowRef = new Window({ url: 'https://budines.test/' });
  windowRef.document.write(html);
  windowRef.document.close();
  vi.stubGlobal('window', windowRef);
  vi.stubGlobal('document', windowRef.document);
  vi.stubGlobal('localStorage', windowRef.localStorage);
  vi.stubGlobal('KeyboardEvent', windowRef.KeyboardEvent);
  vi.stubGlobal('MouseEvent', windowRef.MouseEvent);
}
