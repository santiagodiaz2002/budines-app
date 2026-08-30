import { existsSync, readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  applyScoreChange,
  canUseJoint,
  createBoardGroups,
  createDefaultTrucoState,
  createStickPattern,
  DEFAULT_TRUCO_VISUAL_MODEL,
  getTrucoWinner,
  initTruco,
  sanitizeTrucoState,
  sanitizeTrucoVisualModel,
  TRUCO_VISUAL_MODELS,
  TRUCO_VISUAL_STORAGE_KEY,
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
    initOwnerTruco();

    expect(document.querySelector('[data-truco-team="nosotros"] [data-truco-score]').textContent).toBe('0');
    document.querySelector('[data-truco-team-target="nosotros"][data-truco-action="add"]').click();

    const stored = JSON.parse(window.localStorage.getItem('budines.truco.v1'));
    expect(stored.scores.nosotros).toBe(1);
  });

  it('usa Joint como modelo predeterminado y marca aria-pressed', () => {
    setupDom();
    initOwnerTruco();

    addPoints('nosotros', 5);

    expect(sanitizeTrucoVisualModel('humo-raro', { jointAllowed: true })).toBe(DEFAULT_TRUCO_VISUAL_MODEL);
    expect(document.querySelector('#truco-tool').dataset.trucoVisualModel).toBe('joint');
    expect(visualButton('joint').getAttribute('aria-pressed')).toBe('true');
    expect(visualButton('smoke').getAttribute('aria-pressed')).toBe('false');
    expect(allTallyImages('nosotros').every((image) => image.getAttribute('src') === TRUCO_VISUAL_MODELS.joint.src)).toBe(
      true
    );
  });

  it.each(['santi', 'leandro'])('%s puede alternar Smoke y Joint y conservar la preferencia', (userId) => {
    setupDom();
    const truco = initTruco(undefined, { id: userId });

    expect(canUseJoint(userId)).toBe(true);
    expect(visualButton('joint')).not.toBeNull();
    expect(visualButton('joint').disabled).toBe(false);
    truco.setVisualModel('smoke');
    expect(window.localStorage.getItem(TRUCO_VISUAL_STORAGE_KEY)).toBe('smoke');
    truco.setVisualModel('joint');
    expect(truco.getVisualModel()).toBe('joint');
    expect(window.localStorage.getItem(TRUCO_VISUAL_STORAGE_KEY)).toBe('joint');
  });

  it.each([' SANTI ', 'sAnTi', ' LEANDRO ', 'LeAnDrO'])(
    'normaliza el usuario autorizado %j antes de validar Joint',
    (username) => {
      setupDom();
      const truco = initTruco(undefined, { id: username });

      expect(canUseJoint(username)).toBe(true);
      expect(truco.getVisualModel()).toBe('joint');
      expect(visualButton('joint')).not.toBeNull();
    }
  );

  it('fuerza Smoke para usuarios no autorizados en UI, eventos, estado, persistencia y nueva partida', () => {
    setupDom({ visualModel: 'joint' });
    const jointButton = visualButton('joint');
    const truco = initTruco(undefined, { id: 'usuario-comun', displayName: 'Santi' });

    expect(canUseJoint('usuario-comun')).toBe(false);
    expect(truco.getVisualModel()).toBe('smoke');
    expect(document.querySelector('#truco-tool').dataset.trucoJointAllowed).toBe('false');
    expect(visualButton('joint')).toBeNull();
    expect(jointButton.disabled).toBe(true);
    expect(visualButton('smoke').hidden).toBe(false);
    expect(visualButton('smoke').getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem(TRUCO_VISUAL_STORAGE_KEY)).toBe('smoke');

    jointButton.disabled = false;
    jointButton.dispatchEvent(new windowRef.MouseEvent('click'));
    truco.setVisualModel('joint');
    dispatchSwipe(board(), { startX: 120, startY: 180, endX: 230, endY: 187 });
    truco.reset();

    expect(truco.getVisualModel()).toBe('smoke');
    expect(visualButton('joint')).toBeNull();
    expect(window.localStorage.getItem(TRUCO_VISUAL_STORAGE_KEY)).toBe('smoke');
  });

  it('aplica Smoke sin usuario identificado y no deja Joint en el DOM', () => {
    setupDom({ visualModel: 'joint' });
    const truco = initTruco(undefined, null);

    expect(canUseJoint(null)).toBe(false);
    expect(truco.getVisualModel()).toBe('smoke');
    expect(visualButton('joint')).toBeNull();
    expect(window.localStorage.getItem(TRUCO_VISUAL_STORAGE_KEY)).toBe('smoke');
  });

  it('corrige Joint persistido para un usuario no autorizado y conserva Smoke al recargar', () => {
    setupDom({ visualModel: 'joint' });
    initTruco(undefined, { id: 'usuario-real' });

    expect(window.localStorage.getItem(TRUCO_VISUAL_STORAGE_KEY)).toBe('smoke');

    windowRef.close();
    setupDom({ visualModel: 'smoke' });
    const truco = initTruco(undefined, { id: 'usuario-real' });

    expect(truco.getVisualModel()).toBe('smoke');
    expect(visualButton('joint')).toBeNull();
    expect(visualButton('smoke').getAttribute('aria-pressed')).toBe('true');
  });

  it('seleccionar Smoke y Joint actualiza puntos visibles sin alterar puntaje ni historial', () => {
    setupDom();
    initOwnerTruco();

    addPoints('nosotros', 18);
    addPoints('ellos', 12);
    visualButton('smoke').click();

    expect(scoreText('nosotros')).toBe('18');
    expect(scoreText('ellos')).toBe('12');
    expect(window.localStorage.getItem(TRUCO_VISUAL_STORAGE_KEY)).toBe('smoke');
    expect(visualButton('smoke').getAttribute('aria-pressed')).toBe('true');
    expect(allTallyImages('nosotros').every((image) => image.getAttribute('src') === TRUCO_VISUAL_MODELS.smoke.src)).toBe(
      true
    );
    expect(allTallyImages('ellos').every((image) => image.getAttribute('src') === TRUCO_VISUAL_MODELS.smoke.src)).toBe(
      true
    );

    visualButton('joint').click();

    expect(scoreText('nosotros')).toBe('18');
    expect(scoreText('ellos')).toBe('12');
    expect(window.localStorage.getItem(TRUCO_VISUAL_STORAGE_KEY)).toBe('joint');
    expect(visualButton('joint').getAttribute('aria-pressed')).toBe('true');
    expect(allTallyImages('nosotros').every((image) => image.getAttribute('src') === TRUCO_VISUAL_MODELS.joint.src)).toBe(
      true
    );

    document.querySelector('#truco-undo').click();

    expect(scoreText('nosotros')).toBe('18');
    expect(scoreText('ellos')).toBe('11');
    expect(document.querySelector('#truco-tool').dataset.trucoVisualModel).toBe('joint');
  });

  it('restaura la preferencia visual al recargar y valida valores corruptos', () => {
    setupDom();
    initOwnerTruco();
    visualButton('smoke').click();
    const storedVisualModel = window.localStorage.getItem(TRUCO_VISUAL_STORAGE_KEY);

    windowRef.close();
    setupDom({ visualModel: storedVisualModel });
    initOwnerTruco();

    expect(document.querySelector('#truco-tool').dataset.trucoVisualModel).toBe('smoke');
    expect(visualButton('smoke').getAttribute('aria-pressed')).toBe('true');

    windowRef.close();
    setupDom({ visualModel: 'ceniza' });
    initOwnerTruco();

    expect(document.querySelector('#truco-tool').dataset.trucoVisualModel).toBe('joint');
    expect(visualButton('joint').getAttribute('aria-pressed')).toBe('true');
  });

  it('el swipe horizontal cambia modelo y el movimiento vertical o controles no lo disparan', () => {
    setupDom();
    initOwnerTruco();

    addPoints('nosotros', 5);
    dispatchSwipe(board(), { startX: 230, startY: 180, endX: 120, endY: 188 });

    expect(document.querySelector('#truco-tool').dataset.trucoVisualModel).toBe('smoke');
    expect(scoreText('nosotros')).toBe('5');
    expect(allTallyImages('nosotros').every((image) => image.getAttribute('src') === TRUCO_VISUAL_MODELS.smoke.src)).toBe(
      true
    );

    dispatchSwipe(board(), { startX: 120, startY: 180, endX: 230, endY: 187 });
    expect(document.querySelector('#truco-tool').dataset.trucoVisualModel).toBe('joint');

    dispatchSwipe(board(), { startX: 160, startY: 120, endX: 170, endY: 260 });
    expect(document.querySelector('#truco-tool').dataset.trucoVisualModel).toBe('joint');

    const plus = document.querySelector('[data-truco-team-target="nosotros"][data-truco-action="add"]');
    dispatchSwipe(plus, { startX: 230, startY: 180, endX: 110, endY: 186 });
    plus.click();

    expect(document.querySelector('#truco-tool').dataset.trucoVisualModel).toBe('joint');
    expect(scoreText('nosotros')).toBe('6');
  });

  it('renderiza los palitos con el asset activo limpio y decorativo', () => {
    setupDom();
    initOwnerTruco();

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
    expect([...images].every((image) => image.getAttribute('src') === TRUCO_VISUAL_MODELS.joint.src)).toBe(true);
    expect([...images].every((image) => image.getAttribute('alt') === '')).toBe(true);
  });

  it('mantiene controles externos y seis grupos por equipo', () => {
    setupDom();
    initOwnerTruco();

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
    initOwnerTruco();

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
  ])('renderiza %i puntos con imagenes reales de Joint por defecto', (score, expectedGroups) => {
    setupDom();
    initOwnerTruco();

    addPoints('nosotros', score);

    expect(imageCount('nosotros')).toBe(score);
    expect(groupImageCounts('nosotros')).toEqual(expectedGroups);
    expect(allTallyImages('nosotros').every((image) => image.getAttribute('src') === TRUCO_VISUAL_MODELS.joint.src)).toBe(
      true
    );
  });

  it('cada grupo completo tiene cuatro elementos base y uno diagonal', () => {
    setupDom();
    initOwnerTruco();

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

  it('restar y deshacer actualizan las imagenes del modelo activo', () => {
    setupDom();
    initOwnerTruco();
    visualButton('smoke').click();

    addPoints('nosotros', 3);
    expect(imageCount('nosotros')).toBe(3);
    expect(allTallyImages('nosotros').every((image) => image.getAttribute('src') === TRUCO_VISUAL_MODELS.smoke.src)).toBe(
      true
    );

    document.querySelector('[data-truco-team-target="nosotros"][data-truco-action="subtract"]').click();
    expect(imageCount('nosotros')).toBe(2);

    document.querySelector('[data-truco-team-target="nosotros"][data-truco-action="add"]').click();
    expect(imageCount('nosotros')).toBe(3);

    document.querySelector('#truco-undo').click();
    expect(imageCount('nosotros')).toBe(2);
    expect(allTallyImages('nosotros').every((image) => image.getAttribute('src') === TRUCO_VISUAL_MODELS.smoke.src)).toBe(
      true
    );
  });

  it('Nosotros y Ellos mantienen imagenes independientes', () => {
    setupDom();
    initOwnerTruco();

    addPoints('nosotros', 3);
    addPoints('ellos', 5);

    expect(imageCount('nosotros')).toBe(3);
    expect(imageCount('ellos')).toBe(5);
    expect(groupImageCounts('nosotros')).toEqual([3, 0, 0, 0, 0, 0]);
    expect(groupImageCounts('ellos')).toEqual([5, 0, 0, 0, 0, 0]);
  });

  it('conserva separacion visual despues de los primeros 15', () => {
    setupDom();
    initOwnerTruco();

    const field = document.querySelector('[data-truco-team="nosotros"]');
    const sections = [...field.querySelectorAll('.fifteen-section')];

    expect(sections).toHaveLength(2);
    expect(field.querySelector('.fifteen-divider')).not.toBeNull();
    expect(sections[0].querySelectorAll('[data-truco-group]')).toHaveLength(3);
    expect(sections[1].querySelectorAll('[data-truco-group]')).toHaveLength(3);
  });

  it('cancela y confirma nueva partida con modal', () => {
    setupDom();
    initOwnerTruco();

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

  it.each([
    [TRUCO_VISUAL_MODELS.joint.label, `public${TRUCO_VISUAL_MODELS.joint.src}`],
    [TRUCO_VISUAL_MODELS.smoke.label, `public${TRUCO_VISUAL_MODELS.smoke.src}`]
  ])('el asset real de %s conserva transparencia', async (_label, file) => {
    const metadata = await sharp(file).metadata();

    expect(existsSync(file)).toBe(true);
    expect(metadata.format).toBe('png');
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.width).toBeGreaterThan(450);
    expect(metadata.height).toBeGreaterThan(50);

    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
    expect([
      alphaAt(0, 0),
      alphaAt(info.width - 1, 0),
      alphaAt(0, info.height - 1),
      alphaAt(info.width - 1, info.height - 1)
    ].every((alpha) => alpha === 0)).toBe(true);
  });

  it('versiona app y Truco en el service worker para actualizar la PWA instalada', () => {
    const html = readFileSync('public/index.html', 'utf8');
    const app = readFileSync('public/js/app.js', 'utf8');
    const serviceWorker = readFileSync('public/sw.js', 'utf8');

    expect(html).toContain('/js/app.js?v=operations-20260830');
    expect(app).toContain("./truco.js?v=joint-access-20260805");
    expect(serviceWorker).toContain("budines-shell-v35-operations");
    expect(serviceWorker).toContain('/js/app.js?v=operations-20260830');
    expect(serviceWorker).toContain('/js/truco.js?v=joint-access-20260805');
  });
});

function addPoints(team, count) {
  for (let index = 0; index < count; index += 1) {
    document.querySelector(`[data-truco-team-target="${team}"][data-truco-action="add"]`).click();
  }
}

function initOwnerTruco(userId = 'santi') {
  return initTruco(undefined, { id: userId });
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

function board() {
  return document.querySelector('[data-truco-board]');
}

function dispatchSwipe(target, { startX, startY, endX, endY }) {
  dispatchPointer(target, 'pointerdown', startX, startY);
  dispatchPointer(target, 'pointermove', endX, endY);
  dispatchPointer(target, 'pointerup', endX, endY);
}

function dispatchPointer(target, type, clientX, clientY) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX,
    clientY,
    isPrimary: true,
    pointerId: 1,
    pointerType: 'touch'
  });
  target.dispatchEvent(event);
}

function scoreText(team) {
  return document.querySelector(`[data-truco-team="${team}"] [data-truco-score]`).textContent;
}

function visualButton(model) {
  return document.querySelector(`[data-truco-visual="${model}"]`);
}

function setupDom({ visualModel } = {}) {
  const html = readFileSync('public/index.html', 'utf8');
  windowRef = new Window({ url: 'https://budines.test/' });
  windowRef.document.write(html);
  windowRef.document.close();
  if (visualModel !== undefined) {
    windowRef.localStorage.setItem(TRUCO_VISUAL_STORAGE_KEY, visualModel);
  }
  vi.stubGlobal('window', windowRef);
  vi.stubGlobal('document', windowRef.document);
  vi.stubGlobal('localStorage', windowRef.localStorage);
  vi.stubGlobal('KeyboardEvent', windowRef.KeyboardEvent);
  vi.stubGlobal('MouseEvent', windowRef.MouseEvent);
}
