import { existsSync, readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  applyScoreChange,
  createBoardGroups,
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

  it('renderiza los palitos con el smoke limpio y decorativo', () => {
    setupDom();
    initTruco();

    for (let index = 0; index < 5; index += 1) {
      document.querySelector('[data-truco-team-target="nosotros"][data-truco-action="add"]').click();
    }

    const block = document.querySelector('[data-truco-team="nosotros"] [data-truco-group="0"]');
    const base = block.querySelectorAll('[data-stick="base"]');
    const diagonal = block.querySelectorAll('[data-stick="diagonal"]');
    const images = block.querySelectorAll('img');
    const positions = [...base].map((image) => image.dataset.stickPosition);

    expect(base).toHaveLength(4);
    expect(diagonal).toHaveLength(1);
    expect(positions).toEqual(['left', 'top', 'right', 'bottom']);
    expect([...images].every((image) => image.getAttribute('src') === '/media/smoke.png')).toBe(true);
    expect([...images].every((image) => image.getAttribute('alt') === '')).toBe(true);
  });

  it('mantiene controles externos y seis grupos por equipo', () => {
    setupDom();
    initTruco();

    const board = document.querySelector('[data-truco-board]');
    const columns = [...board.children];
    expect(columns[0].classList.contains('score-rail--left')).toBe(true);
    expect(columns[2].classList.contains('truco-center-line')).toBe(true);
    expect(columns[4].classList.contains('score-rail--right')).toBe(true);

    for (const team of ['nosotros', 'ellos']) {
      const field = document.querySelector(`[data-truco-team="${team}"]`);
      expect(field.querySelectorAll('[data-truco-group]')).toHaveLength(6);
      expect(field.querySelectorAll('.fifteen-section')).toHaveLength(2);
      expect(field.querySelectorAll('.fifteen-section')[0].querySelectorAll('[data-truco-group]')).toHaveLength(3);
      expect(field.querySelectorAll('.fifteen-section')[1].querySelectorAll('[data-truco-group]')).toHaveLength(3);
    }

    expect(columns[0].querySelector('[data-truco-action="add"]')).not.toBeNull();
    expect(columns[0].querySelector('[data-truco-action="subtract"]')).not.toBeNull();
    expect(columns[4].querySelector('[data-truco-action="add"]')).not.toBeNull();
    expect(columns[4].querySelector('[data-truco-action="subtract"]')).not.toBeNull();
  });

  it('mantiene el puntaje total numerico fuera del marcador visual', () => {
    setupDom();
    initTruco();

    addPoints('nosotros', 8);

    expect(document.querySelector('[data-truco-team="nosotros"] [data-truco-score]').textContent).toBe('8');
    const visualGroups = [...document.querySelectorAll('[data-truco-team="nosotros"] [data-truco-group]')];
    expect(visualGroups.every((group) => group.textContent.trim() === '')).toBe(true);
    expect(visualGroups.flatMap((group) => [...group.children]).every((child) => child.tagName === 'IMG')).toBe(true);
  });

  it.each([
    [0, [0, 0, 0, 0, 0, 0]],
    [3, [3, 0, 0, 0, 0, 0]],
    [5, [5, 0, 0, 0, 0, 0]],
    [8, [5, 3, 0, 0, 0, 0]],
    [15, [5, 5, 5, 0, 0, 0]],
    [16, [5, 5, 5, 1, 0, 0]],
    [30, [5, 5, 5, 5, 5, 5]]
  ])('renderiza %i puntos con imagenes reales de smoke', (score, expectedGroups) => {
    setupDom();
    initTruco();

    addPoints('nosotros', score);

    expect(imageCount('nosotros')).toBe(score);
    expect(groupImageCounts('nosotros')).toEqual(expectedGroups);
    expect(allTallyImages('nosotros').every((image) => image.getAttribute('src') === '/media/smoke.png')).toBe(true);
  });

  it('cada grupo completo tiene cuatro smokes base y uno diagonal', () => {
    setupDom();
    initTruco();

    addPoints('nosotros', 15);

    for (const group of [...document.querySelectorAll('[data-truco-team="nosotros"] [data-truco-group]')].slice(0, 3)) {
      expect(group.querySelectorAll('[data-stick="base"]')).toHaveLength(4);
      expect(group.querySelectorAll('[data-stick="diagonal"]')).toHaveLength(1);
      expect([...group.querySelectorAll('[data-stick="base"]')].map((image) => image.dataset.stickPosition)).toEqual([
        'left',
        'top',
        'right',
        'bottom'
      ]);
    }
  });

  it('restar y deshacer actualizan las imagenes de smoke', () => {
    setupDom();
    initTruco();

    addPoints('nosotros', 3);
    expect(imageCount('nosotros')).toBe(3);

    document.querySelector('[data-truco-team-target="nosotros"][data-truco-action="subtract"]').click();
    expect(imageCount('nosotros')).toBe(2);

    document.querySelector('[data-truco-team-target="nosotros"][data-truco-action="add"]').click();
    expect(imageCount('nosotros')).toBe(3);

    document.querySelector('#truco-undo').click();
    expect(imageCount('nosotros')).toBe(2);
  });

  it('Nosotros y Ellos mantienen imagenes independientes', () => {
    setupDom();
    initTruco();

    addPoints('nosotros', 3);
    addPoints('ellos', 5);

    expect(imageCount('nosotros')).toBe(3);
    expect(imageCount('ellos')).toBe(5);
    expect(groupImageCounts('nosotros')).toEqual([3, 0, 0, 0, 0, 0]);
    expect(groupImageCounts('ellos')).toEqual([5, 0, 0, 0, 0, 0]);
  });

  it('conserva separacion visual despues de los primeros 15', () => {
    setupDom();
    initTruco();

    const field = document.querySelector('[data-truco-team="nosotros"]');
    const sections = [...field.querySelectorAll('.fifteen-section')];

    expect(sections).toHaveLength(2);
    expect(field.querySelector('.fifteen-divider')).not.toBeNull();
    expect(sections[0].querySelectorAll('[data-truco-group]')).toHaveLength(3);
    expect(sections[1].querySelectorAll('[data-truco-group]')).toHaveLength(3);
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

  it.each([
    [0, [0, 0, 0, 0, 0, 0]],
    [1, [1, 0, 0, 0, 0, 0]],
    [4, [4, 0, 0, 0, 0, 0]],
    [5, [5, 0, 0, 0, 0, 0]],
    [8, [5, 3, 0, 0, 0, 0]],
    [15, [5, 5, 5, 0, 0, 0]],
    [16, [5, 5, 5, 1, 0, 0]],
    [30, [5, 5, 5, 5, 5, 5]]
  ])('ubica %i puntos en los seis grupos fijos', (score, expected) => {
    const actual = createBoardGroups(score).map((group) => group.vertical + (group.diagonal ? 1 : 0));
    expect(actual).toEqual(expected);
  });

  it('sanitiza historial invalido sin perder puntajes validos', () => {
    const state = sanitizeTrucoState({
      scores: { nosotros: 4, ellos: 7 },
      history: [{ nope: true }]
    });

    expect(state.scores).toEqual({ nosotros: 4, ellos: 7 });
    expect(state.history).toEqual([]);
  });

  it('el asset derivado de smoke conserva transparencia', async () => {
    const metadata = await sharp('public/media/smoke.png').metadata();

    expect(existsSync('public/media/smoke.png')).toBe(true);
    expect(metadata.format).toBe('png');
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.width).toBeGreaterThan(450);
    expect(metadata.height).toBeGreaterThan(50);

    const { data, info } = await sharp('public/media/smoke.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
    expect([
      alphaAt(0, 0),
      alphaAt(info.width - 1, 0),
      alphaAt(0, info.height - 1),
      alphaAt(info.width - 1, info.height - 1)
    ].every((alpha) => alpha === 0)).toBe(true);
  });
});

function addPoints(team, count) {
  for (let index = 0; index < count; index += 1) {
    document.querySelector(`[data-truco-team-target="${team}"][data-truco-action="add"]`).click();
  }
}

function allTallyImages(team) {
  return [...document.querySelectorAll(`[data-truco-team="${team}"] [data-truco-group] img`)];
}

function imageCount(team) {
  return allTallyImages(team).length;
}

function groupImageCounts(team) {
  return [...document.querySelectorAll(`[data-truco-team="${team}"] [data-truco-group]`)].map(
    (group) => group.querySelectorAll('img').length
  );
}

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
