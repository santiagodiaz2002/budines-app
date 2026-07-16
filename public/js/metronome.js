import {
  BEATS_PER_MEASURE,
  DEFAULT_BLOCKS,
  advancePlaybackRuntime,
  cloneSongAsNew,
  createDefaultNamedBlock,
  createPlaybackRuntime,
  createSong,
  deleteSongFromLibrary,
  findSong,
  getCurrentBlock,
  getNextBlock,
  normalizeBlocks,
  parseBpm,
  parseSongName,
  renameSongInLibrary,
  sanitizeSongLibrary,
  selectPreferredVoice,
  serializeBlocks,
  updateSong,
  upsertSongInLibrary,
  validateEditableBlocks
} from './metronome-core.js';

const STORAGE_KEY = 'budines.metronome.v1';
const SONGS_STORAGE_KEY = 'budines.metronome.songs.v1';
const DEFAULT_BPM = 100;
const DEFAULT_VOLUME = 0.65;
const SCHEDULE_AHEAD_SECONDS = 0.12;
const SCHEDULER_MS = 25;
const COUNT_WORDS = new Map([
  [3, 'tres'],
  [2, 'dos'],
  [1, 'uno']
]);

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
    announcement: root.querySelector('#metronome-announcement'),
    count: root.querySelector('#metronome-count'),
    incomingBpm: root.querySelector('#metronome-incoming-bpm'),
    songNow: root.querySelector('#metronome-song-now'),
    partNow: root.querySelector('#metronome-part-now'),
    nextPart: root.querySelector('#metronome-next-part'),
    currentSong: root.querySelector('#metronome-current-song'),
    unsaved: root.querySelector('#metronome-unsaved'),
    saveSong: root.querySelector('#metronome-save-song'),
    saveSongAs: root.querySelector('#metronome-save-song-as'),
    newSong: root.querySelector('#metronome-new-song'),
    songList: root.querySelector('#metronome-song-list'),
    songEmpty: root.querySelector('#metronome-song-empty'),
    songMessage: root.querySelector('#metronome-song-message'),
    dialog: document.querySelector('#metronome-config-dialog'),
    blockList: document.querySelector('#metronome-block-list'),
    addBlock: document.querySelector('#metronome-add-block'),
    restore: document.querySelector('#metronome-restore-blocks'),
    save: document.querySelector('#metronome-save-blocks'),
    cancel: document.querySelector('#metronome-cancel-blocks'),
    error: document.querySelector('#metronome-config-error'),
    nameDialog: document.querySelector('#metronome-name-dialog'),
    nameTitle: document.querySelector('#metronome-name-title'),
    nameCopy: document.querySelector('#metronome-name-copy'),
    nameForm: document.querySelector('#metronome-name-form'),
    nameInput: document.querySelector('#metronome-name-input'),
    nameError: document.querySelector('#metronome-name-error'),
    nameCancel: document.querySelector('#metronome-name-cancel'),
    nameConfirm: document.querySelector('#metronome-name-confirm'),
    confirmDialog: document.querySelector('#metronome-confirm-dialog'),
    confirmTitle: document.querySelector('#metronome-confirm-title'),
    confirmCopy: document.querySelector('#metronome-confirm-copy'),
    confirmCancel: document.querySelector('#metronome-confirm-cancel'),
    confirmAccept: document.querySelector('#metronome-confirm-accept')
  };

  const saved = readState();
  const libraryRead = readLibrary();
  let library = libraryRead.library;
  let currentSongId = library.songs.some((song) => song.id === saved.currentSongId) ? saved.currentSongId : null;
  let blocks = currentSongId ? cloneBlocks(findSong(library, currentSongId).blocks) : cloneBlocks(saved.blocks);
  let savedSnapshot = serializeBlocks(blocks);
  let runtime = createPlaybackRuntime(blocks);
  let running = false;
  let paused = false;
  let saving = false;
  let tapTimes = [];
  let editableBlocks = cloneBlocks(blocks);
  let pendingNameDialog = null;
  let pendingConfirmDialog = null;
  let idCounter = 0;

  const audio = new MetronomeAudio({
    onBeat: handleBeat,
    onCountIn: handleCountIn,
    onAnnounce: handleAnnounce,
    onStatus: setStatus
  });
  audio.setVolume(saved.volume);
  dom.bpm.value = String(blocks[0]?.bpm || saved.bpm);
  dom.volume.value = String(saved.volume);

  coordinator?.register('metronome', stop);

  dom.start.addEventListener('click', start);
  dom.pause.addEventListener('click', togglePause);
  dom.stop.addEventListener('click', () => stop());
  dom.tap.addEventListener('click', tapTempo);
  dom.bpm.addEventListener('change', handleBpmChange);
  dom.volume.addEventListener('input', handleVolumeChange);
  dom.configure.addEventListener('click', openConfig);
  dom.addBlock.addEventListener('click', addEditableBlock);
  dom.restore.addEventListener('click', restoreDefaultBlocks);
  dom.cancel.addEventListener('click', closeConfig);
  dom.save.addEventListener('click', saveConfig);
  dom.dialog.addEventListener('click', (event) => {
    if (event.target === dom.dialog) {
      closeConfig();
    }
  });
  dom.blockList.addEventListener('click', handleBlockListClick);
  dom.blockList.addEventListener('input', () => {
    syncEditableBlocksFromDom();
    clearConfigError();
  });
  dom.saveSong.addEventListener('click', () => saveCurrentSong());
  dom.saveSongAs.addEventListener('click', () => saveCurrentSong({ asNew: true }));
  dom.newSong.addEventListener('click', startNewSong);
  dom.songList.addEventListener('click', handleSongListClick);
  dom.nameForm.addEventListener('submit', handleNameSubmit);
  dom.nameCancel.addEventListener('click', () => closeNameDialog(null));
  dom.nameDialog.addEventListener('click', (event) => {
    if (event.target === dom.nameDialog) {
      closeNameDialog(null);
    }
  });
  dom.confirmCancel.addEventListener('click', () => closeConfirmDialog(false));
  dom.confirmAccept.addEventListener('click', () => closeConfirmDialog(true));
  dom.confirmDialog.addEventListener('click', (event) => {
    if (event.target === dom.confirmDialog) {
      closeConfirmDialog(false);
    }
  });

  document.addEventListener('keydown', handleDocumentKeydown);

  if (libraryRead.hadCorruption) {
    setStatus('Se descartaron canciones locales inválidas.');
  }
  renderAll();
  updateButtons();

  async function start() {
    const parsed = parseBpm(dom.bpm.value);
    if (!parsed.ok) {
      setStatus(parsed.message);
      dom.bpm.focus();
      return;
    }

    await requestAudioFocus();

    if (!running) {
      running = true;
      paused = false;
      runtime = createPlaybackRuntime(blocks);
    }

    const started = await audio.start({ runtime, blocks });
    if (started) {
      setStatus(audio.hasSpeech ? 'Metrónomo en marcha.' : 'Metrónomo en marcha sin voz disponible.');
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

  async function requestAudioFocus() {
    const request = coordinator?.requestStart('metronome');
    if (!request) {
      return;
    }

    try {
      await Promise.race([
        request,
        new Promise((resolve) => {
          getBrowserWindow().setTimeout(resolve, 500);
        })
      ]);
    } catch {
      setStatus('No se pudo coordinar el audio, pero el metrónomo intenta iniciar.');
    }
  }

  function stop({ silent = false } = {}) {
    audio.stop();
    running = false;
    paused = false;
    runtime = createPlaybackRuntime(blocks);
    if (!silent) {
      setStatus('Metrónomo detenido.');
    }
    renderPlayback();
    updateButtons();
  }

  function handleAnnounce(scheduledRuntime) {
    runtime = { ...scheduledRuntime };
    renderPlayback();
  }

  function handleCountIn(scheduledRuntime) {
    pulseIndicator();
    runtime = { ...scheduledRuntime };
    renderPlayback();
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
      blocks = [{ ...blocks[0], bpm: parsed.value, order: 0 }];
    } else {
      blocks = [
        {
          id: createId('block'),
          name: 'Manual',
          measures: 999,
          bpm: parsed.value,
          order: 0
        }
      ];
    }
    runtime = createPlaybackRuntime(blocks);
    if (running) {
      stop({ silent: true });
    }
    persistState();
    renderAll();
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
    editableBlocks = cloneBlocks(blocks);
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

  function addEditableBlock() {
    syncEditableBlocksFromDom();
    editableBlocks.push(createDefaultNamedBlock(editableBlocks.length, currentBpm(), { idFactory: createId }));
    renderEditableBlocks();
  }

  function restoreDefaultBlocks() {
    editableBlocks = cloneBlocks(DEFAULT_BLOCKS);
    renderEditableBlocks();
  }

  function saveConfig() {
    syncEditableBlocksFromDom();
    const validation = validateEditableBlocks(editableBlocks, { idFactory: createId });
    if (!validation.ok) {
      dom.error.textContent = validation.message;
      focusEditableField(validation);
      return;
    }

    blocks = validation.blocks;
    runtime = createPlaybackRuntime(blocks);
    dom.bpm.value = String(blocks[0].bpm);
    if (running) {
      stop({ silent: true });
      setStatus('Configuración guardada. Iniciá de nuevo para escucharla.');
    } else {
      setStatus('Configuración guardada.');
    }
    persistState();
    closeConfig();
    renderAll();
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

    if (action === 'remove') {
      if (editableBlocks.length === 1) {
        dom.error.textContent = 'La secuencia debe tener al menos un bloque.';
        return;
      }
      editableBlocks.splice(index, 1);
    }
    if (action === 'up' && index > 0) {
      [editableBlocks[index - 1], editableBlocks[index]] = [editableBlocks[index], editableBlocks[index - 1]];
    }
    if (action === 'down' && index < editableBlocks.length - 1) {
      [editableBlocks[index + 1], editableBlocks[index]] = [editableBlocks[index], editableBlocks[index + 1]];
    }

    editableBlocks = editableBlocks.map((block, itemIndex) => ({ ...block, order: itemIndex }));
    renderEditableBlocks();
  }

  function syncEditableBlocksFromDom() {
    editableBlocks = [...dom.blockList.querySelectorAll('[data-metronome-block-row]')].map((row) => ({
      id: row.dataset.blockId,
      name: row.querySelector('[data-block-name]').value,
      measures: row.querySelector('[data-block-measures]').value,
      bpm: row.querySelector('[data-block-bpm]').value,
      order: Number(row.dataset.blockIndex)
    }));
  }

  function renderEditableBlocks() {
    dom.blockList.replaceChildren(
      ...editableBlocks.map((block, index) => {
        const row = document.createElement('div');
        row.className = 'metronome-block-row';
        row.dataset.metronomeBlockRow = '';
        row.dataset.blockIndex = String(index);
        row.dataset.blockId = block.id || '';
        row.append(
          createBlockField('Nombre de la parte', 'data-block-name', block.name || '', { className: 'compact-field--name' }),
          createBlockField('Compases', 'data-block-measures', block.measures, { numeric: true }),
          createBlockField('BPM', 'data-block-bpm', block.bpm, { numeric: true }),
          createIconButton('Subir', 'up', index === 0),
          createIconButton('Bajar', 'down', index === editableBlocks.length - 1),
          createIconButton('Eliminar', 'remove', editableBlocks.length === 1)
        );
        return row;
      })
    );
  }

  function createBlockField(label, dataAttribute, value, { numeric = false, className = '' } = {}) {
    const wrapper = document.createElement('label');
    wrapper.className = `compact-field ${className}`.trim();
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.value = String(value ?? '');
    if (numeric) {
      input.inputMode = 'numeric';
    } else {
      input.maxLength = 40;
    }
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

  function focusEditableField(validation) {
    const row = dom.blockList.querySelector(`[data-block-index="${validation.index}"]`);
    row?.querySelector(`[data-block-${validation.field}]`)?.focus();
  }

  async function startNewSong() {
    if (!(await confirmDiscardIfNeeded())) {
      return;
    }

    stop({ silent: true });
    currentSongId = null;
    blocks = cloneBlocks(DEFAULT_BLOCKS);
    savedSnapshot = serializeBlocks(blocks);
    runtime = createPlaybackRuntime(blocks);
    dom.bpm.value = String(blocks[0].bpm);
    persistState();
    renderAll();
    setStatus('Nueva canción lista para editar.');
  }

  async function saveCurrentSong({ asNew = false } = {}) {
    if (saving) {
      return;
    }

    saving = true;
    updateButtons();
    try {
      const now = new Date().toISOString();
      let songResult;
      if (asNew || !currentSongId) {
        const sourceName = getCurrentSong()?.name || 'Nueva canción';
        const requestedName = await requestName({
          title: asNew ? 'Guardar como nueva' : 'Guardar canción',
          copy: asNew ? 'Elegí un nombre para la copia.' : 'Elegí un nombre para esta canción.',
          initialValue: asNew ? `${sourceName} copia` : '',
          confirmText: 'Guardar'
        });
        if (requestedName === null) {
          return;
        }
        songResult = asNew
          ? cloneSongAsNew({ blocks }, { name: requestedName, now, idFactory: createId })
          : createSong({ name: requestedName, blocks, now, idFactory: createId });
      } else {
        const existing = getCurrentSong();
        if (!existing) {
          setStatus('La canción ya no existe. Guardala como nueva.');
          return;
        }
        songResult = updateSong(existing, { blocks, now, idFactory: createId });
      }

      if (!songResult.ok) {
        setStatus(songResult.message);
        return;
      }

      const upsert = upsertSongInLibrary(library, songResult.song);
      if (!upsert.ok) {
        setStatus(upsert.message);
        return;
      }

      library = upsert.library;
      currentSongId = songResult.song.id;
      blocks = cloneBlocks(songResult.song.blocks);
      savedSnapshot = serializeBlocks(blocks);
      if (!running) {
        runtime = createPlaybackRuntime(blocks);
      } else {
        audio.updateBlocks(blocks);
      }
      dom.bpm.value = String(blocks[0].bpm);
      persistLibrary();
      persistState();
      renderAll();
      setStatus('Canción guardada.');
    } finally {
      saving = false;
      updateButtons();
    }
  }

  async function handleSongListClick(event) {
    const button = event.target.closest('[data-song-action]');
    if (!button) {
      return;
    }

    const songId = button.dataset.songId;
    const song = findSong(library, songId);
    if (!song) {
      setSongMessage('La canción ya no está disponible.');
      return;
    }

    if (button.dataset.songAction === 'open') {
      await openSong(song);
    }
    if (button.dataset.songAction === 'rename') {
      await renameSong(song);
    }
    if (button.dataset.songAction === 'delete') {
      await deleteSong(song);
    }
  }

  async function openSong(song) {
    if (!(await confirmDiscardIfNeeded())) {
      return;
    }

    stop({ silent: true });
    currentSongId = song.id;
    blocks = cloneBlocks(song.blocks);
    savedSnapshot = serializeBlocks(blocks);
    runtime = createPlaybackRuntime(blocks);
    dom.bpm.value = String(blocks[0].bpm);
    persistState();
    renderAll();
    setStatus(`Canción abierta: ${song.name}.`);
  }

  async function renameSong(song) {
    const name = await requestName({
      title: 'Renombrar canción',
      copy: 'El nuevo nombre queda guardado solo en este dispositivo.',
      initialValue: song.name,
      confirmText: 'Renombrar'
    });
    if (name === null) {
      return;
    }

    const result = renameSongInLibrary(library, song.id, name, { now: new Date().toISOString() });
    if (!result.ok) {
      setStatus(result.message);
      return;
    }

    library = result.library;
    persistLibrary();
    renderAll();
    setStatus('Canción renombrada.');
  }

  async function deleteSong(song) {
    const confirmed = await requestConfirm({
      title: 'Eliminar canción',
      copy: `Se elimina "${song.name}" de este dispositivo. La configuración comercial no se modifica.`,
      confirmText: 'Eliminar'
    });
    const result = deleteSongFromLibrary(library, song.id, { confirmed });
    if (!result.ok || !result.deleted) {
      setSongMessage('Eliminación cancelada.');
      return;
    }

    library = result.library;
    if (currentSongId === song.id) {
      currentSongId = null;
      savedSnapshot = serializeBlocks(blocks);
    }
    persistLibrary();
    persistState();
    renderAll();
    setStatus('Canción eliminada.');
  }

  async function confirmDiscardIfNeeded() {
    if (!isDirty()) {
      return true;
    }

    return requestConfirm({
      title: 'Cambios sin guardar',
      copy: 'La canción actual tiene cambios sin guardar. Si continuás, se conserva la biblioteca y se descartan esos cambios del editor.',
      confirmText: 'Continuar'
    });
  }

  function requestName({ title, copy, initialValue = '', confirmText = 'Guardar' }) {
    if (pendingNameDialog) {
      return Promise.resolve(null);
    }

    dom.nameTitle.textContent = title;
    dom.nameCopy.textContent = copy;
    dom.nameInput.value = initialValue;
    dom.nameError.textContent = '';
    dom.nameConfirm.textContent = confirmText;
    dom.nameDialog.hidden = false;
    dom.nameInput.focus();
    dom.nameInput.select();

    return new Promise((resolve) => {
      pendingNameDialog = { resolve };
    });
  }

  function handleNameSubmit(event) {
    event.preventDefault();
    const parsed = parseSongName(dom.nameInput.value);
    if (!parsed.ok) {
      dom.nameError.textContent = parsed.message;
      dom.nameInput.focus();
      return;
    }
    closeNameDialog(parsed.value);
  }

  function closeNameDialog(value) {
    if (!pendingNameDialog) {
      return;
    }

    const { resolve } = pendingNameDialog;
    pendingNameDialog = null;
    dom.nameDialog.hidden = true;
    dom.nameInput.value = '';
    dom.nameError.textContent = '';
    resolve(value);
  }

  function requestConfirm({ title, copy, confirmText = 'Confirmar' }) {
    if (pendingConfirmDialog) {
      return Promise.resolve(false);
    }

    dom.confirmTitle.textContent = title;
    dom.confirmCopy.textContent = copy;
    dom.confirmAccept.textContent = confirmText;
    dom.confirmDialog.hidden = false;
    dom.confirmCancel.focus();

    return new Promise((resolve) => {
      pendingConfirmDialog = { resolve };
    });
  }

  function closeConfirmDialog(value) {
    if (!pendingConfirmDialog) {
      return;
    }

    const { resolve } = pendingConfirmDialog;
    pendingConfirmDialog = null;
    dom.confirmDialog.hidden = true;
    resolve(value);
  }

  function handleDocumentKeydown(event) {
    if (event.key !== 'Escape') {
      return;
    }

    if (!dom.nameDialog.hidden) {
      closeNameDialog(null);
      return;
    }
    if (!dom.confirmDialog.hidden) {
      closeConfirmDialog(false);
      return;
    }
    if (!dom.dialog.hidden) {
      closeConfig();
    }
  }

  function renderAll() {
    renderPlayback();
    renderEditor();
    renderLibrary();
    updateButtons();
  }

  function renderPlayback() {
    const currentBlock = getCurrentBlock(runtime, blocks);
    const nextBlock = getNextBlock(runtime, blocks);
    const song = getCurrentSong();
    const isAnnouncing = runtime.phase === 'announce' || runtime.phase === 'countIn';

    dom.songNow.textContent = song?.name || 'Sin guardar';
    dom.partNow.textContent = currentBlock.name;
    dom.nextPart.textContent = nextBlock.name;
    dom.incomingBpm.textContent = String(currentBlock.bpm);
    dom.bpmNow.textContent = String(currentBlock.bpm);
    dom.block.textContent = `${runtime.blockIndex + 1}/${blocks.length}`;

    if (runtime.phase === 'announce') {
      dom.announcement.textContent = `Próximo: ${currentBlock.name}`;
      dom.count.textContent = 'Listo';
      dom.pulse.textContent = '-/4';
      dom.measure.textContent = 'Cuenta';
      return;
    }

    if (runtime.phase === 'countIn') {
      dom.announcement.textContent = `Próximo: ${currentBlock.name}`;
      dom.count.textContent = String(runtime.countInBeat);
      dom.pulse.textContent = `${runtime.countInBeat}`;
      dom.measure.textContent = 'Cuenta';
      return;
    }

    dom.announcement.textContent = isAnnouncing ? `Próximo: ${currentBlock.name}` : `Tocando: ${currentBlock.name}`;
    dom.count.textContent = String(runtime.beatInMeasure);
    dom.pulse.textContent = `${runtime.beatInMeasure}/${BEATS_PER_MEASURE}`;
    dom.measure.textContent = `${runtime.measureInBlock}/${currentBlock.measures}`;
  }

  function renderEditor() {
    const song = getCurrentSong();
    dom.currentSong.textContent = song ? `${song.name} · ${song.blocks.length} bloques` : 'Configuración suelta';
    dom.unsaved.hidden = !isDirty();
  }

  function renderLibrary() {
    const songs = [...library.songs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    dom.songEmpty.hidden = songs.length > 0;
    dom.songList.replaceChildren(...songs.map(createSongCard));
  }

  function createSongCard(song) {
    const card = document.createElement('article');
    card.className = `song-card ${song.id === currentSongId ? 'is-active' : ''}`.trim();
    card.dataset.songId = song.id;

    const head = document.createElement('div');
    head.className = 'song-card-head';

    const titleWrap = document.createElement('div');
    const title = document.createElement('p');
    title.className = 'song-card-title';
    title.textContent = song.name;
    const meta = document.createElement('p');
    meta.className = 'song-card-meta';
    meta.textContent = `Modificada ${formatLocalDateTime(song.updatedAt)}`;
    titleWrap.append(title, meta);

    const count = document.createElement('span');
    count.className = 'song-card-count';
    count.textContent = `${song.blocks.length} bloques`;
    head.append(titleWrap, count);

    const actions = document.createElement('div');
    actions.className = 'song-actions';
    actions.append(
      createSongButton('Abrir', 'open', song.id, 'quiet-button'),
      createSongButton('Renombrar', 'rename', song.id, 'quiet-button'),
      createSongButton('Eliminar', 'delete', song.id, 'danger-button')
    );

    card.append(head, actions);
    return card;
  }

  function createSongButton(label, action, songId, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.songAction = action;
    button.dataset.songId = songId;
    button.textContent = label;
    return button;
  }

  function updateButtons() {
    dom.start.disabled = running && !paused;
    dom.pause.disabled = !running;
    dom.pause.textContent = paused ? 'Reanudar' : 'Pausar';
    dom.stop.disabled = !running && runtime.phase === 'announce' && runtime.blockIndex === 0;
    dom.saveSong.disabled = saving;
    dom.saveSongAs.disabled = saving;
    dom.saveSong.textContent = saving ? 'Guardando...' : 'Guardar canción';
  }

  function isDirty() {
    return serializeBlocks(blocks) !== savedSnapshot;
  }

  function getCurrentSong() {
    return currentSongId ? findSong(library, currentSongId) : null;
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
        blocks,
        currentSongId
      })
    );
  }

  function persistLibrary() {
    getStorage()?.setItem(SONGS_STORAGE_KEY, JSON.stringify(library));
  }

  function setStatus(message) {
    dom.status.textContent = message;
  }

  function setSongMessage(message) {
    dom.songMessage.textContent = message;
  }

  function clearConfigError() {
    dom.error.textContent = '';
  }

  function pulseIndicator() {
    dom.indicator.classList.remove('is-pulsing');
    dom.indicator.offsetWidth;
    dom.indicator.classList.add('is-pulsing');
  }

  function createId(prefix = 'id') {
    idCounter += 1;
    const random = globalThis.crypto?.randomUUID?.() || globalThis.window?.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${random}-${idCounter}`;
  }

  return {
    stop,
    getState: () => ({
      blocks: cloneBlocks(blocks),
      runtime: { ...runtime },
      running,
      paused,
      currentSongId,
      songs: cloneSongs(library.songs),
      dirty: isDirty()
    })
  };
}

class MetronomeAudio {
  constructor({ onBeat, onCountIn, onAnnounce, onStatus }) {
    this.onBeat = onBeat;
    this.onCountIn = onCountIn;
    this.onAnnounce = onAnnounce;
    this.onStatus = onStatus;
    this.context = null;
    this.gain = null;
    this.timer = null;
    this.transitionTimer = null;
    this.nextNoteTime = 0;
    this.runtime = null;
    this.blocks = [];
    this.volume = DEFAULT_VOLUME;
    this.sequence = 0;
    this.speech = new MetronomeSpeech();
    this.scheduledNodes = new Set();
    this.announcing = false;
  }

  get hasSpeech() {
    return this.speech.available;
  }

  setVolume(value) {
    this.volume = value;
    if (this.gain) {
      this.gain.gain.value = value;
    }
  }

  async start({ runtime, blocks }) {
    this.runtime = { ...runtime };
    this.blocks = normalizeBlocks(blocks);
    if (this.timer || this.transitionTimer || this.announcing) {
      return false;
    }

    const browserWindow = getBrowserWindow();
    const AudioContextClass = browserWindow.AudioContext || browserWindow.webkitAudioContext;
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

    try {
      const resumeResult = this.context.resume?.();
      resumeResult?.catch?.(() => this.onStatus('No se pudo reanudar el audio.'));
    } catch {
      this.onStatus('No se pudo iniciar el audio.');
      return false;
    }
    this.sequence += 1;
    this.beginPhase(this.sequence);
    return true;
  }

  pause() {
    this.sequence += 1;
    this.clearTimers();
    this.announcing = false;
    this.speech.cancel();
    this.stopScheduledClicks();
  }

  resume({ runtime, blocks }) {
    if (this.timer || this.transitionTimer || this.announcing || !this.context) {
      return false;
    }
    this.runtime = { ...runtime };
    this.blocks = normalizeBlocks(blocks);
    this.context.resume?.();
    this.sequence += 1;
    this.beginPhase(this.sequence);
    return true;
  }

  stop() {
    this.sequence += 1;
    this.pause();
    this.nextNoteTime = 0;
    this.runtime = null;
  }

  updateRuntime(runtime) {
    this.runtime = { ...runtime };
  }

  updateBlocks(blocks) {
    this.blocks = normalizeBlocks(blocks);
  }

  beginPhase(sequence) {
    if (!this.context || !this.runtime || sequence !== this.sequence) {
      return;
    }

    this.clearTimers();
    if (this.runtime.phase === 'announce') {
      const announcedRuntime = { ...this.runtime };
      const block = getCurrentBlock(announcedRuntime, this.blocks);
      this.onAnnounce(announcedRuntime, block);
      this.speech.cancel();
      this.announcing = true;
      this.speech.speak(block.name, { rate: 1.05, cancelPrevious: false }).then(() => {
        this.announcing = false;
        if (sequence !== this.sequence || !this.runtime) {
          return;
        }
        this.runtime = advancePlaybackRuntime(this.runtime, this.blocks);
        this.nextNoteTime = this.context.currentTime + 0.05;
        this.startScheduler(sequence);
      });
      return;
    }

    this.nextNoteTime = this.context.currentTime + 0.05;
    this.startScheduler(sequence);
  }

  startScheduler(sequence) {
    if (this.timer || !this.context || !this.runtime) {
      return false;
    }
    const browserWindow = getBrowserWindow();
    this.timer = browserWindow.setInterval(() => this.scheduler(sequence), SCHEDULER_MS);
    this.scheduler(sequence);
    return true;
  }

  scheduler(sequence) {
    if (!this.context || !this.runtime || sequence !== this.sequence) {
      return;
    }

    const browserWindow = getBrowserWindow();
    while (this.timer && this.nextNoteTime < this.context.currentTime + SCHEDULE_AHEAD_SECONDS) {
      const scheduledRuntime = { ...this.runtime };
      if (scheduledRuntime.phase === 'announce') {
        this.beginPhase(sequence);
        break;
      }

      const scheduledTime = this.nextNoteTime;
      const callbackDelay = Math.max(0, (scheduledTime - this.context.currentTime) * 1000);
      const accented = scheduledRuntime.phase === 'playing' && scheduledRuntime.beatInMeasure === 1;
      this.scheduleClick(scheduledTime, accented);

      browserWindow.setTimeout(() => {
        if (sequence !== this.sequence) {
          return;
        }
        if (scheduledRuntime.phase === 'countIn') {
          this.onCountIn(scheduledRuntime);
          const word = COUNT_WORDS.get(scheduledRuntime.countInBeat) || String(scheduledRuntime.countInBeat);
          this.speech.speak(word, { rate: 1.42, cancelPrevious: true });
        } else {
          this.onBeat(scheduledRuntime);
        }
      }, callbackDelay);

      this.runtime = advancePlaybackRuntime(this.runtime, this.blocks);
      this.nextNoteTime += 60 / scheduledRuntime.bpm;

      if (this.runtime.phase === 'announce') {
        this.clearScheduler();
        this.transitionTimer = browserWindow.setTimeout(() => {
          this.transitionTimer = null;
          this.beginPhase(sequence);
        }, callbackDelay + 80);
        break;
      }
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
    oscillator.addEventListener?.('ended', () => this.scheduledNodes.delete(oscillator));
    this.scheduledNodes.add(oscillator);
    oscillator.start(time);
    oscillator.stop(time + 0.06);
  }

  clearScheduler() {
    if (this.timer) {
      getBrowserWindow().clearInterval(this.timer);
      this.timer = null;
    }
  }

  clearTimers() {
    this.clearScheduler();
    if (this.transitionTimer) {
      getBrowserWindow().clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
  }

  stopScheduledClicks() {
    for (const oscillator of this.scheduledNodes) {
      try {
        oscillator.stop(0);
      } catch {
        // The node may already have ended.
      }
    }
    this.scheduledNodes.clear();
  }
}

class MetronomeSpeech {
  constructor() {
    const browserWindow = getBrowserWindow();
    this.synthesis = browserWindow.speechSynthesis || null;
    this.Utterance = browserWindow.SpeechSynthesisUtterance || null;
    this.voice = null;
    if (this.synthesis) {
      this.refreshVoices();
      if (typeof this.synthesis.addEventListener === 'function') {
        this.synthesis.addEventListener('voiceschanged', () => this.refreshVoices());
      } else if ('onvoiceschanged' in this.synthesis) {
        this.synthesis.onvoiceschanged = () => this.refreshVoices();
      }
    }
  }

  get available() {
    return Boolean(this.synthesis && this.Utterance);
  }

  refreshVoices() {
    const voices = this.synthesis?.getVoices?.() || [];
    this.voice = selectPreferredVoice(voices);
  }

  speak(text, { rate = 1, cancelPrevious = true } = {}) {
    if (!this.available || !text) {
      return Promise.resolve(false);
    }

    this.refreshVoices();
    if (cancelPrevious) {
      this.cancel();
    }

    const browserWindow = getBrowserWindow();
    return new Promise((resolve) => {
      const utterance = new this.Utterance(text);
      utterance.lang = this.voice?.lang || 'es-AR';
      if (this.voice) {
        utterance.voice = this.voice;
      }
      utterance.rate = rate;
      utterance.pitch = 1;
      utterance.volume = 1;

      let finished = false;
      const timeoutMs = Math.min(3200, Math.max(650, text.length * 120));
      const timer = browserWindow.setTimeout(() => {
        this.cancel();
        finish(false);
      }, timeoutMs);

      const finish = (value) => {
        if (finished) {
          return;
        }
        finished = true;
        browserWindow.clearTimeout(timer);
        resolve(value);
      };

      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);

      try {
        this.synthesis.speak(utterance);
      } catch {
        finish(false);
      }
    });
  }

  cancel() {
    this.synthesis?.cancel?.();
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
      blocks: normalizeBlocks(parsed?.blocks),
      currentSongId: typeof parsed?.currentSongId === 'string' ? parsed.currentSongId : null
    };
  } catch {
    return {
      bpm: DEFAULT_BPM,
      volume: DEFAULT_VOLUME,
      blocks: cloneBlocks(DEFAULT_BLOCKS),
      currentSongId: null
    };
  }
}

function readLibrary() {
  try {
    const raw = getStorage()?.getItem(SONGS_STORAGE_KEY);
    if (!raw) {
      return {
        library: sanitizeSongLibrary({ songs: [] }),
        hadCorruption: false
      };
    }

    const parsed = JSON.parse(raw);
    const library = sanitizeSongLibrary(parsed);
    const rawCount = Array.isArray(parsed?.songs) ? parsed.songs.length : 0;
    return {
      library,
      hadCorruption: rawCount !== library.songs.length
    };
  } catch {
    return {
      library: sanitizeSongLibrary({ songs: [] }),
      hadCorruption: true
    };
  }
}

function cloneBlocks(blocks) {
  return normalizeBlocks(blocks).map((block, index) => ({ ...block, order: index }));
}

function cloneSongs(songs) {
  return songs.map((song) => ({
    ...song,
    blocks: cloneBlocks(song.blocks)
  }));
}

function formatLocalDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'sin fecha';
  }
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function getStorage() {
  return globalThis.localStorage || globalThis.window?.localStorage || null;
}

function getBrowserWindow() {
  return globalThis.window || globalThis;
}
