import { getStorage, scopedStorageKey } from './local-storage.js?v=auth-20260723';

const STORAGE_KEY = 'budines.truco.v1';
export const TRUCO_VISUAL_STORAGE_KEY = 'budines.truco.visual.v1';
export const DEFAULT_TRUCO_VISUAL_MODEL = 'joint';
const JOINT_ALLOWED_USERS = new Set(['santi', 'leandro']);
export const TRUCO_VISUAL_MODELS = Object.freeze({
  joint: Object.freeze({
    id: 'joint',
    label: 'Joint',
    src: '/media/joint-clean.png',
    width: 489,
    height: 90
  }),
  smoke: Object.freeze({
    id: 'smoke',
    label: 'Smoke',
    src: '/media/smoke.png',
    width: 489,
    height: 62
  })
});
const TEAM_IDS = ['nosotros', 'ellos'];
const DEFAULT_TEAMS = {
  nosotros: 'Nosotros',
  ellos: 'Ellos'
};
const MAX_SCORE = 30;
const MIN_SCORE = 0;
const BASE_STICK_POSITIONS = ['left', 'top', 'right', 'bottom'];
const SWIPE_MIN_DISTANCE = 46;
const SWIPE_MAX_VERTICAL = 42;
const SWIPE_DOMINANCE = 1.55;

export function createDefaultTrucoState() {
  return {
    scores: {
      nosotros: 0,
      ellos: 0
    },
    history: []
  };
}

export function sanitizeTrucoState(value) {
  if (!value || typeof value !== 'object') {
    return createDefaultTrucoState();
  }

  const scores = value.scores;
  if (!scores || typeof scores !== 'object') {
    return createDefaultTrucoState();
  }

  const normalizedScores = {};
  for (const team of TEAM_IDS) {
    if (!Number.isInteger(scores[team]) || scores[team] < MIN_SCORE || scores[team] > MAX_SCORE) {
      return createDefaultTrucoState();
    }
    normalizedScores[team] = scores[team];
  }

  const history = Array.isArray(value.history) ? value.history : [];
  const normalizedHistory = [];
  for (const entry of history.slice(-100)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const before = entry.before;
    const after = entry.after;
    if (isValidScores(before) && isValidScores(after)) {
      normalizedHistory.push({
        before: { nosotros: before.nosotros, ellos: before.ellos },
        after: { nosotros: after.nosotros, ellos: after.ellos }
      });
    }
  }

  return {
    scores: normalizedScores,
    history: normalizedHistory
  };
}

export function canUseJoint(username) {
  return JOINT_ALLOWED_USERS.has(String(username ?? '').trim().toLowerCase());
}

export function sanitizeTrucoVisualModel(value, { jointAllowed = false } = {}) {
  const normalized = Object.prototype.hasOwnProperty.call(TRUCO_VISUAL_MODELS, value)
    ? value
    : DEFAULT_TRUCO_VISUAL_MODEL;
  return normalized === 'joint' && !jointAllowed ? 'smoke' : normalized;
}

export function applyScoreChange(state, team, delta) {
  if (!TEAM_IDS.includes(team) || !Number.isInteger(delta) || delta === 0) {
    return state;
  }

  const current = state.scores[team];
  const next = clampScore(current + delta);
  if (next === current) {
    return state;
  }

  const before = { ...state.scores };
  const scores = {
    ...state.scores,
    [team]: next
  };

  return {
    scores,
    history: [...state.history, { before, after: scores }].slice(-100)
  };
}

export function undoScoreChange(state) {
  if (!state.history.length) {
    return state;
  }

  const history = state.history.slice(0, -1);
  const last = state.history[state.history.length - 1];
  return {
    scores: { ...last.before },
    history
  };
}

export function resetTrucoState() {
  return createDefaultTrucoState();
}

export function getTrucoWinner(scores) {
  if (scores.nosotros >= MAX_SCORE) {
    return 'Nosotros';
  }
  if (scores.ellos >= MAX_SCORE) {
    return 'Ellos';
  }
  return null;
}

export function createStickPattern(score) {
  return createBoardGroups(score).filter((group) => group.vertical > 0 || group.diagonal);
}

export function createBoardGroups(score) {
  const safeScore = clampScore(score);
  return Array.from({ length: 6 }, (_, groupIndex) => {
    const count = Math.min(5, Math.max(0, safeScore - groupIndex * 5));
    return {
      vertical: Math.min(4, count),
      diagonal: count === 5
    };
  });
}

export function initTruco(root = document.querySelector('#truco-tool'), authenticatedUser = null) {
  if (!root) {
    return null;
  }

  const dom = {
    teams: new Map(TEAM_IDS.map((team) => [team, root.querySelector(`[data-truco-team="${team}"]`)])),
    controls: new Map(
      TEAM_IDS.map((team) => [
        team,
        {
          minus: root.querySelector(`[data-truco-team-target="${team}"][data-truco-minus]`),
          plus: root.querySelector(`[data-truco-team-target="${team}"][data-truco-plus]`)
        }
      ])
    ),
    winner: root.querySelector('#truco-winner'),
    undo: root.querySelector('#truco-undo'),
    reset: root.querySelector('#truco-reset'),
    visualToggle: root.querySelector('.truco-visual-toggle'),
    visualButtons: [...root.querySelectorAll('[data-truco-visual]')],
    board: root.querySelector('[data-truco-board]'),
    dialog: document.querySelector('#truco-reset-dialog'),
    resetCancel: document.querySelector('#truco-reset-cancel'),
    resetConfirm: document.querySelector('#truco-reset-confirm')
  };

  let state = readState();
  let jointAllowed = canUseJoint(authenticatedUser?.id);
  let visualModel = readVisualModel(jointAllowed);
  let swipeStart = null;

  preloadTallyAssets(jointAllowed);

  root.addEventListener('click', (event) => {
    const scoreButton = event.target.closest('[data-truco-action]');
    if (!scoreButton) {
      return;
    }

    const team = scoreButton.dataset.trucoTeamTarget;
    const delta = scoreButton.dataset.trucoAction === 'add' ? 1 : -1;
    state = applyScoreChange(state, team, delta);
    persistState(state);
    render();
  });

  for (const button of dom.visualButtons) {
    button.addEventListener('click', () => {
      setVisualModel(button.dataset.trucoVisual);
    });
  }

  dom.board?.addEventListener('pointerdown', handleSwipeStart);
  dom.board?.addEventListener('pointermove', handleSwipeMove);
  dom.board?.addEventListener('pointerup', handleSwipeEnd);
  dom.board?.addEventListener('pointercancel', clearSwipe);

  dom.undo?.addEventListener('click', () => {
    state = undoScoreChange(state);
    persistState(state);
    render();
  });

  dom.reset?.addEventListener('click', () => {
    dom.dialog.hidden = false;
    dom.resetCancel.focus();
  });

  dom.resetCancel?.addEventListener('click', closeDialog);
  dom.dialog?.addEventListener('click', (event) => {
    if (event.target === dom.dialog) {
      closeDialog();
    }
  });
  dom.resetConfirm?.addEventListener('click', () => {
    state = resetTrucoState();
    persistState(state);
    closeDialog();
    render();
    dom.reset.focus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dom.dialog && !dom.dialog.hidden) {
      closeDialog();
    }
  });

  function closeDialog() {
    if (dom.dialog) {
      dom.dialog.hidden = true;
    }
    dom.reset?.focus();
  }

  function setVisualModel(value) {
    const nextModel = sanitizeTrucoVisualModel(value, { jointAllowed });
    persistVisualModel(nextModel, jointAllowed);
    if (visualModel === nextModel) {
      renderVisualControls();
      return;
    }

    visualModel = nextModel;
    render();
  }

  function handleSwipeStart(event) {
    if (event.isPrimary === false || isSwipeIgnoredTarget(event.target)) {
      swipeStart = null;
      return;
    }

    swipeStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      vertical: false
    };
  }

  function handleSwipeMove(event) {
    if (!isSameSwipe(event)) {
      return;
    }

    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
      swipeStart.vertical = true;
    }
  }

  function handleSwipeEnd(event) {
    if (!isSameSwipe(event)) {
      clearSwipe();
      return;
    }

    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    const isHorizontal =
      Math.abs(dx) >= SWIPE_MIN_DISTANCE &&
      Math.abs(dy) <= SWIPE_MAX_VERTICAL &&
      Math.abs(dx) > Math.abs(dy) * SWIPE_DOMINANCE;

    if (!swipeStart.vertical && isHorizontal) {
      setVisualModel(dx < 0 ? 'smoke' : 'joint');
    }
    clearSwipe();
  }

  function isSameSwipe(event) {
    return Boolean(swipeStart && (swipeStart.pointerId == null || event.pointerId === swipeStart.pointerId));
  }

  function clearSwipe() {
    swipeStart = null;
  }

  function render() {
    renderVisualControls();

    for (const team of TEAM_IDS) {
      const teamRoot = dom.teams.get(team);
      if (!teamRoot) {
        continue;
      }

      const score = state.scores[team];
      const scoreNode = teamRoot.querySelector('[data-truco-score]');
      if (scoreNode) {
        scoreNode.textContent = String(score);
      }
      const controls = dom.controls.get(team);
      if (controls?.minus) {
        controls.minus.disabled = score <= MIN_SCORE;
      }
      if (controls?.plus) {
        controls.plus.disabled = score >= MAX_SCORE;
      }

      const groups = createBoardGroups(score);
      for (const groupRoot of teamRoot.querySelectorAll('[data-truco-group]')) {
        const groupIndex = Number(groupRoot.dataset.trucoGroup);
        const group = groups[groupIndex] || { vertical: 0, diagonal: false };
        groupRoot.replaceChildren(...createStickNodes(group, visualModel, jointAllowed));
        groupRoot.setAttribute(
          'aria-label',
          `${DEFAULT_TEAMS[team]} puntos ${groupIndex * 5 + 1} a ${groupIndex * 5 + 5}: ${groupPoints(group)}`
        );
      }
    }

    const winner = getTrucoWinner(state.scores);
    if (dom.winner) {
      dom.winner.textContent = winner ? `Ganó ${winner}` : 'Partida a 30 puntos';
      dom.winner.classList.toggle('is-active', Boolean(winner));
    }
    if (dom.undo) {
      dom.undo.disabled = state.history.length === 0;
    }
  }

  function renderVisualControls() {
    root.dataset.trucoVisualModel = visualModel;
    root.dataset.trucoJointAllowed = jointAllowed ? 'true' : 'false';

    const jointButton = dom.visualButtons.find((button) => button.dataset.trucoVisual === 'joint');
    const smokeButton = dom.visualButtons.find((button) => button.dataset.trucoVisual === 'smoke');
    if (jointButton) {
      jointButton.disabled = !jointAllowed;
      if (jointAllowed && !jointButton.isConnected) {
        dom.visualToggle?.insertBefore(jointButton, smokeButton || null);
      } else if (!jointAllowed) {
        jointButton.remove();
      }
    }

    for (const button of dom.visualButtons) {
      const pressed = button.dataset.trucoVisual === visualModel;
      button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    }
  }

  render();

  return {
    getState: () => structuredClone(state),
    getVisualModel: () => visualModel,
    setVisualModel,
    setAuthenticatedUser(user) {
      jointAllowed = canUseJoint(user?.id);
      state = readState();
      visualModel = readVisualModel(jointAllowed);
      preloadTallyAssets(jointAllowed);
      render();
    },
    reset() {
      state = resetTrucoState();
      persistState(state);
      visualModel = sanitizeTrucoVisualModel(visualModel, { jointAllowed });
      persistVisualModel(visualModel, jointAllowed);
      render();
    }
  };
}

function createStickNodes(group, visualModel = DEFAULT_TRUCO_VISUAL_MODEL, jointAllowed = false) {
  const model = TRUCO_VISUAL_MODELS[sanitizeTrucoVisualModel(visualModel, { jointAllowed })];
  const nodes = [];

  for (let index = 0; index < group.vertical; index += 1) {
    const position = BASE_STICK_POSITIONS[index];
    const img = document.createElement('img');
    img.className = `stick-img stick-img--base stick-img--${position}`;
    img.dataset.stick = 'base';
    img.dataset.stickPosition = position;
    img.dataset.trucoVisualModel = model.id;
    img.src = model.src;
    img.width = model.width;
    img.height = model.height;
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'eager';
    nodes.push(img);
  }

  if (group.diagonal) {
    const img = document.createElement('img');
    img.className = 'stick-img stick-img--diagonal';
    img.dataset.stick = 'diagonal';
    img.dataset.trucoVisualModel = model.id;
    img.src = model.src;
    img.width = model.width;
    img.height = model.height;
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'eager';
    nodes.push(img);
  }

  return nodes;
}

function groupPoints(group) {
  return group.vertical + (group.diagonal ? 1 : 0);
}

function readState() {
  try {
    return sanitizeTrucoState(JSON.parse(getStorage()?.getItem(scopedStorageKey(STORAGE_KEY))));
  } catch {
    return createDefaultTrucoState();
  }
}

function readVisualModel(jointAllowed) {
  try {
    const storage = getStorage();
    const key = scopedStorageKey(TRUCO_VISUAL_STORAGE_KEY);
    const storedValue = storage?.getItem(key);
    const sanitizedValue = sanitizeTrucoVisualModel(storedValue, { jointAllowed });
    if (storage && storedValue !== sanitizedValue) {
      storage.setItem(key, sanitizedValue);
    }
    return sanitizedValue;
  } catch {
    return sanitizeTrucoVisualModel(DEFAULT_TRUCO_VISUAL_MODEL, { jointAllowed });
  }
}

function persistState(state) {
  getStorage()?.setItem(scopedStorageKey(STORAGE_KEY), JSON.stringify(state));
}

function persistVisualModel(value, jointAllowed) {
  const sanitizedValue = sanitizeTrucoVisualModel(value, { jointAllowed });
  getStorage()?.setItem(scopedStorageKey(TRUCO_VISUAL_STORAGE_KEY), sanitizedValue);
}

function preloadTallyAssets(jointAllowed) {
  const ImageClass = globalThis.Image || globalThis.window?.Image;
  if (!ImageClass) {
    return;
  }

  const models = jointAllowed ? Object.values(TRUCO_VISUAL_MODELS) : [TRUCO_VISUAL_MODELS.smoke];
  for (const model of models) {
    const image = new ImageClass();
    image.decoding = 'async';
    image.src = model.src;
  }
}

function isSwipeIgnoredTarget(target) {
  return Boolean(target?.closest?.('button, a, input, textarea, select, [role="button"], [data-truco-no-swipe]'));
}

function isValidScores(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      TEAM_IDS.every((team) => Number.isInteger(value[team]) && value[team] >= MIN_SCORE && value[team] <= MAX_SCORE)
  );
}

function clampScore(value) {
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, value));
}
