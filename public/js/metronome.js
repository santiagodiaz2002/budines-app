import {
  BEATS_PER_MEASURE,
  DEFAULT_BLOCKS,
  advanceRuntime,
  createRuntime,
  getCurrentBlock,
  normalizeBlocks,
  parseBpm,
  parseMeasures
} from './metronome-core.js';

const STORAGE_KEY = 'budines.metronome.v1';
const DEFAULT_BPM = 100;
const DEFAULT_VOLUME = 0.65;
const SCHEDULE_AHEAD_SECONDS = 0.12;
const SCHEDULER_MS = 25;

export function initMetronome(root = document.querySelector('#metronome-tool'), coordinator) {
  if (!root) {
    return null;
  }

  const dom = {
    bpm: root.querySelector('#metronome-bpm'),
    start: root.querySelector('#metronome-start'),
    pause: root.querySelector('#metronome-pause'),
    stop: root.querySelector('#metronome-stop'),
    tap: root.querySelector('#metronome-tap'),
    volume: root.querySelector('#metronome-volume'),
    status: root.querySelector('#metronome-status'),
    pulse: root.querySelector('#metronome-pulse'),
    measure: root.querySelector('#metronome-measure'),
    block: root.querySelector('#metronome-block'),
    bpmNow: root.querySelector('#metronome-bpm-now'),
    indicator: root.querySelector('#metronome-indicator'),
    configure: root.querySelector('#metronome-configure'),
    dialog: document.querySelector('#metronome-config-dialog'),
    blockList: document.querySelector('#metronome-block-list'),
    addBlock: document.querySelector('#metronome-add-block'),
    restore: document.querySelector('#metronome-restore-blocks'),
    save: document.querySelector('#metronome-save-blocks'),
    cancel: document.querySelector('#metronome-cancel-blocks'),
    error: document.querySelector('#metronome-config-error')
  };

  const saved = readState();
  let blocks = saved.blocks;
  let runtime = createRuntime(blocks);
  let running = false;
  let paused = false;
  let tapTimes = [];
  let editableBlocks = blocks.map((block) => ({ ...block }));
  const audio = new MetronomeAudio({
    onBeat: handleBeat,
    onStatus: setStatus
  });
  audio.setVolume(saved.volume);
  dom.bpm.value = String(saved.bpm);
  dom.volume.value = String(saved.volume);

  coordinator?.register('metronome', stop);

  dom.start.addEventListener('click', start);
  dom.pause.addEventListener('click', togglePause);
  dom.stop.addEventListener('click', stop);
  dom.tap.addEventListener('click', tapTempo);
  dom.bpm.addEventListener('change', handleBpmChange);
  dom.volume.addEventListener('input', handleVolumeChange);
  dom.configure.addEventListener('click', openConfig);
  dom.addBlock.addEventListener('click', () => {
    editableBlocks.push({ measures: 4, bpm: currentBpm() });
    renderEditableBlocks();
  });
  dom.restore.addEventListener('click', () => {
    editableBlocks = DEFAULT_BLOCKS.map((block) => ({ ...block }));
    renderEditableBlocks();
  });
  dom.cancel.addEventListener('click', closeConfig);
  dom.save.addEventListener('click', saveConfig);
  dom.dialog.addEventListener('click', (event) => {
    if (event.target === dom.dialog) {
      closeConfig();
    }
  });
  dom.blockList.addEventListener('click', handleBlockListClick);
  dom.blockList.addEventListener('input', clearConfigError);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dom.dialog.hidden) {
      closeConfig();
    }
  });

  renderPlayback();
  updateButtons();

  async function start() {
    const parsed = parseBpm(dom.bpm.value);
    if (!parsed.ok) {
      setStatus(parsed.message);
      dom.bpm.focus();
      return;
    }

    await coordinator?.requestStart('metronome');

    if (!running) {
      running = true;
      paused = false;
      runtime = createRuntime(blocks);
    }

    if (audio.start({ runtime, blocks })) {
      setStatus('Metrónomo en marcha.');
    }
    updateButtons();
    renderPlayback();
  }

  function togglePause() {
    if (!running) {
      return;
    }

    if (paused) {
      paused = false;
      audio.resume({ runtime, blocks });
      setStatus('Metrónomo reanudado.');
    } else {
      paused = true;
      audio.pause();
      setStatus('Metrónomo pausado.');
    }
    updateButtons();
  }

  function stop() {
    audio.stop();
    running = false;
    paused = false;
    runtime = createRuntime(blocks);
    setStatus('Metrónomo detenido.');
    renderPlayback();
    updateButtons();
  }

  function handleBeat(scheduledRuntime) {
    pulseIndicator();
    runtime = { ...scheduledRuntime };
    renderPlayback();
  }

  function handleBpmChange() {
    const parsed = parseBpm(dom.bpm.value);
    if (!parsed.ok) {
      setStatus(parsed.message);
      return;
    }

    if (blocks.length === 1) {
      blocks = [{ measures: blocks[0].measures, bpm: parsed.value }];
    } else {
      blocks = [{ measures: 999, bpm: parsed.value }];
    }
    runtime = createRuntime(blocks);
    persistState();
    audio.updateBlocks(blocks);
    renderPlayback();
    setStatus('BPM actualizado.');
  }

  function handleVolumeChange() {
    const value = Number(dom.volume.value);
    const volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_VOLUME;
    audio.setVolume(volume);
    persistState();
  }

  function tapTempo() {
    const now = performance.now();
    tapTimes = tapTimes.filter((time) => now - time <= 2400);
    tapTimes.push(now);

    if (tapTimes.length < 2) {
      setStatus('Tocá al menos dos veces.');
      return;
    }

    const intervals = [];
    for (let index = 1; index < tapTimes.length; index += 1) {
      intervals.push(tapTimes[index] - tapTimes[index - 1]);
    }
    const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    const bpm = Math.round(60000 / average);
    const parsed = parseBpm(String(bpm));
    if (!parsed.ok) {
      setStatus('Tap fuera de rango.');
      return;
    }

    dom.bpm.value = String(parsed.value);
    handleBpmChange();
    setStatus(`Tap tempo: ${parsed.value} BPM.`);
  }

  function openConfig() {
    editableBlocks = blocks.map((block) => ({ ...block }));
    renderEditableBlocks();
    dom.error.textContent = '';
    dom.dialog.hidden = false;
    dom.addBlock.focus();
  }

  function closeConfig() {
    dom.dialog.hidden = true;
    dom.error.textContent = '';
    dom.configure.focus();
  }

  function saveConfig() {
    const rows = [...dom.blockList.querySelectorAll('[data-metronome-block-row]')];
    const nextBlocks = [];

    for (const row of rows) {
      const measures = parseMeasures(row.querySelector('[data-block-measures]').value);
      const bpm = parseBpm(row.querySelector('[data-block-bpm]').value);
      if (!measures.ok) {
        dom.error.textContent = measures.message;
        return;
      }
      if (!bpm.ok) {
        dom.error.textContent = bpm.message;
        return;
      }
      nextBlocks.push({ measures: measures.value, bpm: bpm.value });
    }

    if (!nextBlocks.length) {
      dom.error.textContent = 'La secuencia debe tener al menos un bloque.';
      return;
    }

    blocks = nextBlocks;
    runtime = createRuntime(blocks);
    dom.bpm.value = String(blocks[0].bpm);
    audio.updateBlocks(blocks);
    persistState();
    closeConfig();
    renderPlayback();
    setStatus('Configuración guardada.');
  }

  function handleBlockListClick(event) {
    const button = event.target.closest('[data-block-action]');
    if (!button) {
      return;
    }

    syncEditableBlocksFromDom();
    const row = button.closest('[data-metronome-block-row]');
    const index = Number(row.dataset.blockIndex);
    const action = button.dataset.blockAction;

    if (action === 'remove' && editableBlocks.length > 1) {
      editableBlocks.splice(index, 1);
    }
    if (action === 'up' && index > 0) {
      [editableBlocks[index - 1], editableBlocks[index]] = [editableBlocks[index], editableBlocks[index - 1]];
    }
    if (action === 'down' && index < editableBlocks.length - 1) {
      [editableBlocks[index + 1], editableBlocks[index]] = [editableBlocks[index], editableBlocks[index + 1]];
    }

    renderEditableBlocks();
  }

  function syncEditableBlocksFromDom() {
    editableBlocks = [...dom.blockList.querySelectorAll('[data-metronome-block-row]')].map((row) => ({
      measures: Number(row.querySelector('[data-block-measures]').value) || 4,
      bpm: Number(row.querySelector('[data-block-bpm]').value) || currentBpm()
    }));
  }

  function renderEditableBlocks() {
    dom.blockList.replaceChildren(
      ...editableBlocks.map((block, index) => {
        const row = document.createElement('div');
        row.className = 'metronome-block-row';
        row.dataset.metronomeBlockRow = '';
        row.dataset.blockIndex = String(index);
        row.append(
          createBlockField('Compases', 'data-block-measures', block.measures),
          createBlockField('BPM', 'data-block-bpm', block.bpm),
          createIconButton('Subir', 'up', index === 0),
          createIconButton('Bajar', 'down', index === editableBlocks.length - 1),
          createIconButton('Eliminar', 'remove', editableBlocks.length === 1)
        );
        return row;
      })
    );
  }

  function createBlockField(label, dataAttribute, value) {
    const wrapper = document.createElement('label');
    wrapper.className = 'compact-field';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.value = String(value);
    input.setAttribute(dataAttribute, '');
    wrapper.append(span, input);
    return wrapper;
  }

  function createIconButton(label, action, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.dataset.blockAction = action;
    button.disabled = disabled;
    button.setAttribute('aria-label', label);
    button.textContent = action === 'up' ? '↑' : action === 'down' ? '↓' : '×';
    return button;
  }

  function clearConfigError() {
    dom.error.textContent = '';
  }

  function renderPlayback() {
    const currentBlock = getCurrentBlock(runtime, blocks);
    dom.pulse.textContent = `${runtime.beatInMeasure}/${BEATS_PER_MEASURE}`;
    dom.measure.textContent = `${runtime.measureInBlock}/${currentBlock.measures}`;
    dom.block.textContent = `${runtime.blockIndex + 1}/${blocks.length}`;
    dom.bpmNow.textContent = String(runtime.bpm);
  }

  function updateButtons() {
    dom.start.disabled = running && !paused;
    dom.pause.disabled = !running;
    dom.pause.textContent = paused ? 'Reanudar' : 'Pausar';
    dom.stop.disabled = !running && runtime.beatInMeasure === 1 && runtime.measureInBlock === 1 && runtime.blockIndex === 0;
  }

  function currentBpm() {
    const parsed = parseBpm(dom.bpm.value);
    return parsed.ok ? parsed.value : DEFAULT_BPM;
  }

  function persistState() {
    getStorage()?.setItem(
      STORAGE_KEY,
      JSON.stringify({
        bpm: currentBpm(),
        volume: Number(dom.volume.value),
        blocks
      })
    );
  }

  function getStorage() {
    return globalThis.localStorage || globalThis.window?.localStorage || null;
  }

  function setStatus(message) {
    dom.status.textContent = message;
  }

  function pulseIndicator() {
    dom.indicator.classList.remove('is-pulsing');
    dom.indicator.offsetWidth;
    dom.indicator.classList.add('is-pulsing');
  }

  return {
    stop,
    getState: () => ({
      blocks: blocks.map((block) => ({ ...block })),
      runtime: { ...runtime },
      running,
      paused
    })
  };
}

class MetronomeAudio {
  constructor({ onBeat, onStatus }) {
    this.onBeat = onBeat;
    this.onStatus = onStatus;
    this.context = null;
    this.gain = null;
    this.timer = null;
    this.nextNoteTime = 0;
    this.runtime = null;
    this.blocks = [];
    this.volume = DEFAULT_VOLUME;
  }

  setVolume(value) {
    this.volume = value;
    if (this.gain) {
      this.gain.gain.value = value;
    }
  }

  start({ runtime, blocks }) {
    this.runtime = { ...runtime };
    this.blocks = normalizeBlocks(blocks);
    if (this.timer) {
      return false;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      this.onStatus('Este navegador no soporta Web Audio API.');
      return false;
    }

    if (!this.context) {
      this.context = new AudioContextClass();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }

    this.context.resume?.();
    this.nextNoteTime = this.context.currentTime + 0.05;
    this.timer = window.setInterval(() => this.scheduler(), SCHEDULER_MS);
    this.scheduler();
    return true;
  }

  pause() {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  resume({ runtime, blocks }) {
    if (this.timer) {
      return false;
    }
    this.runtime = { ...runtime };
    this.blocks = normalizeBlocks(blocks);
    this.nextNoteTime = this.context.currentTime + 0.05;
    this.timer = window.setInterval(() => this.scheduler(), SCHEDULER_MS);
    return true;
  }

  stop() {
    this.pause();
    this.nextNoteTime = 0;
  }

  updateRuntime(runtime) {
    this.runtime = { ...runtime };
  }

  updateBlocks(blocks) {
    this.blocks = normalizeBlocks(blocks);
  }

  scheduler() {
    if (!this.context || !this.runtime) {
      return;
    }

    while (this.nextNoteTime < this.context.currentTime + SCHEDULE_AHEAD_SECONDS) {
      const scheduledRuntime = { ...this.runtime };
      const scheduledTime = this.nextNoteTime;
      this.scheduleClick(scheduledTime, scheduledRuntime.beatInMeasure === 1);
      window.setTimeout(
        () => this.onBeat(scheduledRuntime),
        Math.max(0, (scheduledTime - this.context.currentTime) * 1000)
      );
      this.runtime = advanceRuntime(this.runtime, this.blocks);
      this.nextNoteTime += 60 / scheduledRuntime.bpm;
    }
  }

  scheduleClick(time, accented) {
    const oscillator = this.context.createOscillator();
    const clickGain = this.context.createGain();
    oscillator.frequency.value = accented ? 1120 : 760;
    clickGain.gain.setValueAtTime(0.0001, time);
    clickGain.gain.exponentialRampToValueAtTime(accented ? 0.78 : 0.44, time + 0.003);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
    oscillator.connect(clickGain);
    clickGain.connect(this.gain);
    oscillator.start(time);
    oscillator.stop(time + 0.06);
  }
}

function readState() {
  try {
    const parsed = JSON.parse(getStorage()?.getItem(STORAGE_KEY));
    const bpm = Number.isInteger(parsed?.bpm) && parseBpm(String(parsed.bpm)).ok ? parsed.bpm : DEFAULT_BPM;
    const volume = Number.isFinite(parsed?.volume) ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULT_VOLUME;
    return {
      bpm,
      volume,
      blocks: normalizeBlocks(parsed?.blocks)
    };
  } catch {
    return {
      bpm: DEFAULT_BPM,
      volume: DEFAULT_VOLUME,
      blocks: DEFAULT_BLOCKS.map((block) => ({ ...block }))
    };
  }
}

function getStorage() {
  return globalThis.localStorage || globalThis.window?.localStorage || null;
}
