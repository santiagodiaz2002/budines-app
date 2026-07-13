const STORAGE_KEY = 'budines.truco.v1';
const TEAM_IDS = ['nosotros', 'ellos'];
const DEFAULT_TEAMS = {
  nosotros: 'Nosotros',
  ellos: 'Ellos'
};
const MAX_SCORE = 30;
const MIN_SCORE = 0;
const JOINT_SRC = '/media/joint.jpg';

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
  const safeScore = clampScore(score);
  const groups = [];
  let remaining = safeScore;

  while (remaining > 0) {
    const count = Math.min(5, remaining);
    groups.push({
      vertical: Math.min(4, count),
      diagonal: count === 5
    });
    remaining -= count;
  }

  return groups;
}

export function initTruco(root = document.querySelector('#truco-tool')) {
  if (!root) {
    return null;
  }

  const dom = {
    teams: new Map(TEAM_IDS.map((team) => [team, root.querySelector(`[data-truco-team="${team}"]`)])),
    winner: root.querySelector('#truco-winner'),
    undo: root.querySelector('#truco-undo'),
    reset: root.querySelector('#truco-reset'),
    dialog: document.querySelector('#truco-reset-dialog'),
    resetCancel: document.querySelector('#truco-reset-cancel'),
    resetConfirm: document.querySelector('#truco-reset-confirm')
  };

  let state = readState();

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
    if (event.key === 'Escape' && !dom.dialog.hidden) {
      closeDialog();
    }
  });

  function closeDialog() {
    dom.dialog.hidden = true;
    dom.reset.focus();
  }

  function render() {
    for (const team of TEAM_IDS) {
      const teamRoot = dom.teams.get(team);
      if (!teamRoot) {
        continue;
      }

      const score = state.scores[team];
      teamRoot.querySelector('[data-truco-score]').textContent = String(score);
      teamRoot.querySelector('[data-truco-minus]').disabled = score <= MIN_SCORE;
      teamRoot.querySelector('[data-truco-plus]').disabled = score >= MAX_SCORE;
      const sticks = teamRoot.querySelector('[data-truco-sticks]');
      sticks.replaceChildren(...createStickNodes(score));
      sticks.setAttribute('aria-label', `${DEFAULT_TEAMS[team]} ${score} puntos`);
    }

    const winner = getTrucoWinner(state.scores);
    dom.winner.textContent = winner ? `Ganó ${winner}` : 'Partida a 30 puntos';
    dom.winner.classList.toggle('is-active', Boolean(winner));
    dom.undo.disabled = state.history.length === 0;
  }

  render();

  return {
    getState: () => structuredClone(state),
    reset() {
      state = resetTrucoState();
      persistState(state);
      render();
    }
  };
}

function createStickNodes(score) {
  return createStickPattern(score).map((group, groupIndex) => {
    const block = document.createElement('div');
    block.className = 'stick-block';
    block.dataset.stickBlock = String(groupIndex + 1);

    for (let index = 0; index < group.vertical; index += 1) {
      const img = document.createElement('img');
      img.className = 'stick-img stick-img--vertical';
      img.dataset.stick = 'vertical';
      img.src = JOINT_SRC;
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.style.setProperty('--stick-index', String(index));
      block.append(img);
    }

    if (group.diagonal) {
      const img = document.createElement('img');
      img.className = 'stick-img stick-img--diagonal';
      img.dataset.stick = 'diagonal';
      img.src = JOINT_SRC;
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      block.append(img);
    }

    return block;
  });
}

function readState() {
  try {
    return sanitizeTrucoState(JSON.parse(getStorage()?.getItem(STORAGE_KEY)));
  } catch {
    return createDefaultTrucoState();
  }
}

function persistState(state) {
  getStorage()?.setItem(STORAGE_KEY, JSON.stringify(state));
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

function getStorage() {
  return globalThis.localStorage || globalThis.window?.localStorage || null;
}
