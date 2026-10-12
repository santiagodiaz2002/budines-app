import {
  BEATS_PER_MEASURE,
  DEFAULT_BLOCKS,
  MAX_PARTS,
  advancePlaybackRuntime,
  createDefaultNamedBlock,
  createPlaybackRuntime,
  getAnnouncementWord,
  getCurrentBlock,
  getNextBlock,
  getPlaybackBpm,
  getPlaybackInterval,
  normalizeBlocks,
  parseBpm,
  parsePartName,
  parseSongName,
  sanitizeSongLibrary,
  selectPreferredVoice,
  serializeSongDraft,
  validateEditableBlocks
} from './metronome-core-v2.js?v=songbook-20261012';
import { getStorage, scopedStorageKey } from './local-storage.js?v=auth-20260723';
import { createSongbookClient } from './songbook-client.js?v=songbook-20261012';

const STORAGE_KEY = 'budines.metronome.v1';
const SONGS_STORAGE_KEY = 'budines.metronome.songs.v2';
const OLD_SONGS_STORAGE_KEY = 'budines.metronome.songs.v1';
const DEFAULT_BPM = 100;
const DEFAULT_VOLUME = 0.65;
const DEFAULT_VOICE_VOLUME = 1;
const SCHEDULE_AHEAD_SECONDS = 0.12;
const SCHEDULER_MS = 25;
const ASSET_VERSION = 'metronome-continuous-20260716';

export function initMetronome(root = document.querySelector('#metronome-tool'), coordinator, options = {}) {
  if (!root) {
    return null;
  }

  const dom = collectDom(root);
  const saved = readState();
  const libraryRead = readLibrary();
  let library = libraryRead.library;
  let currentSongId = (saved.sharedSong && options.authenticated === true) || library.songs.some((song) => song.id === saved.currentSongId) ? saved.currentSongId : null;
  let songName = findSong(library, currentSongId)?.name || saved.songName;
  let blocks = findSong(library, currentSongId) ? cloneBlocks(findSong(library, currentSongId).blocks) : cloneBlocks(saved.blocks);
  let savedSnapshot = saved.savedSnapshot || serializeSongDraft({ name: songName, blocks });
  let dialogSnapshot = savedSnapshot;
  let dialogBlocksSnapshot = cloneBlocks(blocks);
  let dialogNameSnapshot = songName;
  let runtime = createPlaybackRuntime(playbackBlocks());
  let running = false;
  let paused = false;
  let saving = false;
  let tapTimes = [];
  let editingPartIndex = null;
  let idCounter = 0;
  let pendingNameDialog = null;
  let pendingConfirmDialog = null;
  const songbook = options.client || createSongbookClient();
  let authenticated = options.authenticated === true;
  let ready = false;
  let folders = [];
  let activeFolderId = null;
  let songFolderId = saved.songFolderId;
  let currentRevision = saved.sharedSong ? saved.currentRevision : null;
  let generation = 0;
  let mutationVersion = 0;
  let refreshing = false;
  let pendingCreate = saved.pendingCreate;
  let pendingFolderCreation = saved.pendingFolderCreation;
  let playbackOperation = 0;
  let startingAudio = false;

  const speech = new MetronomeSpeech({
    onVoicesChanged: () => {
      renderVoiceOptions();
      persistState();
    },
    onError: (message) => {
      if (running) {
        setStatus(message);
      }
    }
  });
  const audio = new MetronomeAudio({
    speech,
    getSpeechSettings: () => ({
      announceParts: dom.announceParts.checked,
      voiceURI: dom.voiceSelect.value,
      volume: Number(dom.voiceVolume.value) || DEFAULT_VOICE_VOLUME
    }),
    onBeat: handleBeat,
    onCountIn: handleCountIn,
    onStatus: setStatus
  });

  audio.setVolume(saved.volume);
  dom.bpm.value = String(playbackBlocks()[0]?.bpm || saved.bpm);
  dom.volume.value = String(saved.volume);
  dom.announceParts.checked = saved.announceParts;
  dom.voiceVolume.value = String(saved.voiceVolume);

  coordinator?.register('metronome', stop);
  bindEvents();

  renderAll();
  updateButtons();
  setSession({ authenticated });
  const refreshTimer = getBrowserWindow().setInterval(() => {
    if (authenticated && ready && !root.hidden && document.visibilityState !== 'hidden' && dom.dialog.hidden && !saving) refreshLibrary();
  }, 15000);
  getBrowserWindow().addEventListener('online', () => { if (authenticated) refreshLibrary({ importLocal: true }); });
  getBrowserWindow().addEventListener('focus', () => { if (authenticated && dom.dialog.hidden) refreshLibrary(); });
  getBrowserWindow().addEventListener('beforeunload', (event) => {
    if (isDirty() || saving) { event.preventDefault(); event.returnValue = ''; }
  });

  function bindEvents() {
    dom.refresh.addEventListener('click', () => refreshLibrary({ importLocal: true }));
    dom.newFolder.addEventListener('click', () => editFolder());
    dom.folderBack.addEventListener('click', () => { activeFolderId = null; renderLibrary(); });
    dom.folderList.addEventListener('click', handleFolderClick);
    dom.start.addEventListener('click', start);
    dom.pause.addEventListener('click', togglePause);
    dom.stop.addEventListener('click', () => stop());
    dom.restart?.addEventListener('click', restart);
    dom.tap.addEventListener('click', tapTempo);
    dom.bpm.addEventListener('change', handleBpmChange);
    dom.volume.addEventListener('input', handleVolumeChange);
    dom.configure.addEventListener('click', openConfig);
    dom.addBlock.addEventListener('click', addPart);
    dom.restore.addEventListener('click', restoreBasicPart);
    dom.cancel.addEventListener('click', cancelConfigChanges);
    dom.save.addEventListener('click', () => saveCurrentSong({ asNew: false }));
    dom.saveBlocksAs.addEventListener('click', () => saveCurrentSong({ asNew: true }));
    dom.saveSong.addEventListener('click', () => saveCurrentSong({ asNew: false }));
    dom.saveSongAs.addEventListener('click', () => saveCurrentSong({ asNew: true }));
    dom.newSong.addEventListener('click', startNewSong);
    dom.songName.addEventListener('input', () => {
      songName = dom.songName.value;
      renderEditor();
      persistState();
    });
    dom.dialog.addEventListener('click', (event) => {
      if (event.target === dom.dialog) {
        cancelConfigChanges();
      }
    });
    dom.blockList.addEventListener('click', handleBlockListClick);
    dom.blockList.addEventListener('input', handleBlockListInput);
    dom.blockList.addEventListener('keydown', handleBlockListKeydown);
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
    dom.announceParts.addEventListener('change', () => {
      persistState();
      setStatus(dom.announceParts.checked ? 'Anuncios activados.' : 'Anuncios desactivados.');
    });
    dom.voiceSelect.addEventListener('change', persistState);
    dom.voiceVolume.addEventListener('input', persistState);
    dom.testVoice.addEventListener('click', testVoice);
    document.addEventListener('keydown', handleDocumentKeydown);
  }

  async function start() {
    if (running || startingAudio) return;
    const operation = ++playbackOperation;
    startingAudio = true;
    updateButtons();
    const parsed = parseBpm(dom.bpm.value);
    if (!parsed.ok) {
      startingAudio = false;
      updateButtons();
      setStatus(parsed.message);
      dom.bpm.focus();
      return;
    }
    if (!validatePlaybackDraft()) { startingAudio = false; updateButtons(); return; }

    await requestAudioFocus();
    if (operation !== playbackOperation) return;
    const startRuntime = createPlaybackRuntime(playbackBlocks());
    const started = await audio.start({ runtime: startRuntime, blocks: playbackBlocks() });
    if (operation !== playbackOperation) return;
    startingAudio = false;
    if (!started) {
      running = false;
      paused = false;
      updateButtons();
      return;
    }

    running = true;
    paused = false;
    runtime = startRuntime;
    setStatus(speech.available ? 'Metrónomo en marcha.' : 'Metrónomo en marcha sin voz disponible.');
    updateButtons();
    renderPlayback();
  }

  async function togglePause() {
    if (!running) {
      return;
    }

    if (paused) {
      if (startingAudio) return;
      const operation = ++playbackOperation;
      startingAudio = true;
      updateButtons();
      const resumed = await audio.resume({ runtime, blocks: playbackBlocks() });
      if (operation !== playbackOperation) return;
      startingAudio = false;
      if (!resumed) { updateButtons(); return; }
      paused = false;
      setStatus('Metrónomo reanudado.');
    } else {
      paused = true;
      audio.pause();
      setStatus('Metrónomo pausado.');
    }
    updateButtons();
  }

  function stop({ silent = false } = {}) {
    playbackOperation++;
    startingAudio = false;
    audio.stop();
    running = false;
    paused = false;
    runtime = createPlaybackRuntime(playbackBlocks());
    if (!silent) {
      setStatus('Metrónomo detenido.');
    }
    renderPlayback();
    updateButtons();
  }

  async function restart() {
    const operation = ++playbackOperation;
    startingAudio = true;
    updateButtons();
    if (!validatePlaybackDraft()) { startingAudio = false; updateButtons(); return; }
    await requestAudioFocus();
    if (operation !== playbackOperation) return;
    const startRuntime = createPlaybackRuntime(playbackBlocks());
    const started = await audio.restart({ runtime: startRuntime, blocks: playbackBlocks() });
    if (operation !== playbackOperation) return;
    startingAudio = false;
    if (!started) {
      running = false;
      paused = false;
      updateButtons();
      return;
    }

    running = true;
    paused = false;
    runtime = startRuntime;
    setStatus('Metrónomo reiniciado.');
    updateButtons();
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

    if (!dom.dialog.hidden) syncBlocksFromDom();
    if (!blocks.length) blocks = [createDefaultNamedBlock(0, parsed.value, { idFactory: createId })];
    const index = Math.min(runtime.blockIndex, blocks.length - 1);
    blocks = blocks.map((block, position) => position === index
      ? { ...block, bpm: parsed.value, ramp: block.ramp ? { ...block.ramp, enabled: false } : undefined }
      : block);

    runtime = createPlaybackRuntime(playbackBlocks());
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
    if (saving) return;
    dialogSnapshot = serializeSongDraft({ name: songName, blocks });
    dialogBlocksSnapshot = cloneBlocks(blocks);
    dialogNameSnapshot = songName;
    editingPartIndex = null;
    dom.songName.value = songName;
    renderEditableBlocks();
    renderVoiceOptions();
    clearConfigError();
    dom.dialog.hidden = false;
    dom.songName.focus();
  }

  function cancelConfigChanges() {
    if (saving) return;
    songName = dialogNameSnapshot;
    blocks = cloneBlocks(dialogBlocksSnapshot);
    editingPartIndex = null;
    runtime = createPlaybackRuntime(playbackBlocks());
    dom.dialog.hidden = true;
    clearConfigError();
    renderAll();
    persistState();
    dom.configure.focus();
  }

  function addPart() {
    if (saving) return;
    syncBlocksFromDom();
    if (blocks.length >= MAX_PARTS) {
      setConfigError(`32 de 32 partes. Eliminá una parte para agregar otra.`);
      renderEditableBlocks();
      return;
    }
    blocks.push(createDefaultNamedBlock(blocks, currentBpm(), { idFactory: createId }));
    blocks = blocks.map((block, index) => ({ ...block, order: index }));
    editingPartIndex = null;
    renderEditableBlocks();
    renderEditor();
    persistState();
  }

  function restoreBasicPart() {
    if (saving) return;
    blocks = cloneBlocks(DEFAULT_BLOCKS);
    songName = dom.songName.value;
    editingPartIndex = null;
    renderEditableBlocks();
    renderEditor();
    persistState();
    setStatus('Secuencia básica restaurada.');
  }

  async function saveCurrentSong({ asNew = false } = {}) {
    if (saving || !authenticated || !ready) {
      return;
    }

    if (!commitPendingNameEdit({ allowInvalid: false })) {
      return;
    }

    if (!dom.dialog.hidden) {
      songName = dom.songName.value;
      syncBlocksFromDom();
    }
    const nameValidation = parseSongName(songName);
    if (!nameValidation.ok) {
      setConfigError(nameValidation.message);
      if (!dom.dialog.hidden) {
        dom.songName.focus();
      } else {
        openConfig();
        dom.songName.focus();
      }
      return;
    }

    const blocksValidation = validateEditableBlocks(blocks, { idFactory: createId });
    if (!blocksValidation.ok) {
      setConfigError(blocksValidation.message);
      if (!dom.dialog.hidden) {
        focusEditableField(blocksValidation);
      } else {
        openConfig();
      }
      return;
    }

    saving = true;
    const sessionTicket = generation;
    let refreshAfterSave = false;
    updateButtons();
    try {
      const submitted = { name: nameValidation.value, blocks: blocksValidation.blocks, folderId: songFolderId };
      const submittedSnapshot = serializeSongDraft(submitted);
      const creating = asNew || !currentSongId || pendingCreate?.snapshot === submittedSnapshot;
      if (creating && pendingCreate?.snapshot !== submittedSnapshot) {
        pendingCreate = { snapshot: submittedSnapshot, id: globalThis.crypto.randomUUID() };
      }
      persistState();
      const response = await songbook.mutate({
        action: creating ? 'createSong' : 'updateSong',
        song: { ...submitted, id: creating ? pendingCreate.id : currentSongId, revision: currentRevision }
      });
      if (sessionTicket !== generation || !authenticated) return;
      mutationVersion++;
      const song = response.song;
      library.songs = [...library.songs.filter((item) => item.id !== song.id), song];
      currentSongId = song.id;
      currentRevision = song.revision;
      songFolderId = song.folderId;
      songName = song.name;
      blocks = cloneBlocks(song.blocks);
      pendingCreate = null;
      savedSnapshot = serializeSongDraft({ name: songName, blocks });
      dialogSnapshot = savedSnapshot;
      dialogBlocksSnapshot = cloneBlocks(blocks);
      dialogNameSnapshot = songName;
      dom.songName.value = songName;
      dom.bpm.value = String(playbackBlocks()[0].bpm);
      if (running) {
        stop({ silent: true });
      }
      runtime = createPlaybackRuntime(playbackBlocks());
      persistState();
      renderAll();
      clearConfigError();
      setStatus(asNew ? 'Canción guardada como nueva.' : 'Canción guardada.');
      setSongMessage('Guardada en el cancionero compartido.');
    } catch (error) {
      if (sessionTicket !== generation) return;
      setConfigError(error.message);
      setSongMessage(error.message);
      refreshAfterSave = error.status === 409;
    } finally {
      if (sessionTicket === generation) {
        saving = false; updateButtons();
        if (refreshAfterSave) await refreshLibrary();
      }
    }
  }

  async function startNewSong() {
    if (saving) return;
    if (!(await confirmDiscardIfNeeded())) {
      return;
    }

    stop({ silent: true });
    currentSongId = null;
    currentRevision = null;
    songFolderId = activeFolderId;
    songName = '';
    blocks = [];
    savedSnapshot = serializeSongDraft({ name: songName, blocks });
    runtime = createPlaybackRuntime(playbackBlocks());
    persistState();
    renderAll();
    openConfig();
    setStatus('Nueva canción lista para editar.');
  }

  async function handleSongListClick(event) {
    if (saving) return;
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
    if (button.dataset.songAction === 'move') await moveSong(song, button.closest('.song-card').querySelector('[data-song-folder]').value || null);
  }

  async function openSong(song) {
    if (!(await confirmDiscardIfNeeded())) {
      return;
    }

    stop({ silent: true });
    currentSongId = song.id;
    currentRevision = song.revision;
    songFolderId = song.folderId || null;
    songName = song.name;
    blocks = cloneBlocks(song.blocks);
    savedSnapshot = serializeSongDraft({ name: songName, blocks });
    runtime = createPlaybackRuntime(playbackBlocks());
    dom.bpm.value = String(playbackBlocks()[0].bpm);
    persistState();
    renderAll();
    setStatus(`Canción abierta: ${song.name}.`);
  }

  async function renameSong(song) {
    if (!authenticated || !ready) return;
    const name = await requestName({
      title: 'Renombrar canción',
      copy: 'El nuevo nombre se comparte con todos los usuarios.',
      initialValue: song.name,
      confirmText: 'Renombrar'
    });
    if (name === null) {
      return;
    }

    await mutateLibrary(async (isCurrent) => {
      const response = await songbook.mutate({ action: 'updateSong', song: { ...song, name, revision: currentSongId === song.id ? currentRevision : song.revision } });
      if (!isCurrent()) return;
      library.songs = library.songs.map(item => item.id === song.id ? response.song : item);
      if (currentSongId === song.id) {
        if (songName === song.name) songName = response.song.name;
        // Conserve unsaved blocks; the snapshot describes only the server content.
        savedSnapshot = serializeSongDraft(response.song);
        currentRevision = response.song.revision;
      }
      persistState();
      renderAll();
      setStatus('Canción renombrada.');
    });
  }

  async function deleteSong(song) {
    if (!authenticated || !ready) return;
    const confirmed = await requestConfirm({
      title: 'Eliminar canción',
      copy: `Se elimina "${song.name}" del cancionero compartido para todos los usuarios.`,
      confirmText: 'Eliminar'
    });
    if (!confirmed) {
      setSongMessage('Eliminación cancelada.');
      return;
    }

    await mutateLibrary(async (isCurrent) => {
      await songbook.mutate({ action: 'deleteSong', id: song.id, revision: song.revision });
      if (!isCurrent()) return;
      library.songs = library.songs.filter(item => item.id !== song.id);
      if (currentSongId === song.id) { currentSongId = null; currentRevision = null; }
      persistState();
      renderAll();
      setStatus('Canción eliminada.');
    });
  }

  async function confirmDiscardIfNeeded() {
    if (!isDirty()) {
      return true;
    }

    return requestConfirm({
      title: 'Cambios sin guardar',
      copy: 'La canción actual tiene cambios sin guardar. Si continuás, se descartan esos cambios del editor.',
      confirmText: 'Continuar'
    });
  }

  function setSession(session) {
    const wasShared = currentRevision !== null || saved.sharedSong;
    generation++;
    stop({ silent: true });
    saving = false;
    authenticated = session.authenticated === true;
    ready = false;
    refreshing = false;
    folders = [];
    if (authenticated) {
      library = { songs: [] };
      refreshLibrary({ importLocal: true });
    } else {
      pendingCreate = null;
      pendingFolderCreation = null;
      library = readLibrary().library;
      closeNameDialog(null);
      closeConfirmDialog(false);
      dom.dialog.hidden = true;
      if (wasShared) {
        currentSongId = null;
        currentRevision = null;
        songName = '';
        blocks = cloneBlocks(DEFAULT_BLOCKS);
        savedSnapshot = serializeSongDraft({ name: songName, blocks });
      }
      setSongMessage('Sin sesión online: podés reproducir las canciones locales originales. Para guardar o ver el cancionero compartido, iniciá sesión con conexión.');
    }
    renderAll();
  }

  async function refreshLibrary({ importLocal = false } = {}) {
    if (!authenticated || refreshing || saving) return;
    const ticket = generation;
    const version = mutationVersion;
    refreshing = true;
    dom.refresh.disabled = true;
    setSongMessage(importLocal ? 'Recuperando canciones locales y cargando el cancionero…' : 'Actualizando cancionero…');
    try {
      const report = importLocal ? await songbook.importLegacy() : null;
      const response = await songbook.list();
      if (ticket !== generation || version !== mutationVersion) return;
      if (report?.mappings?.[currentSongId]) currentSongId = report.mappings[currentSongId];
      library = { songs: response.songs };
      folders = response.folders;
      ready = true;
      if (activeFolderId && !folders.some(folder => folder.id === activeFolderId)) activeFolderId = null;
      if (songFolderId && !folders.some(folder => folder.id === songFolderId)) songFolderId = null;
      const current = getCurrentSong();
      if (current && currentRevision === null) {
        currentRevision = current.revision;
        songFolderId = current.folderId;
        if (!isDirty()) loadRemoteSong(current);
      } else if (current && currentRevision !== current.revision) {
        if (!isDirty() && !running && dom.dialog.hidden) loadRemoteSong(current);
        else setStatus('Esta canción cambió en otro dispositivo. Tu edición se conserva; guardá como nueva o volvé a abrirla para revisar la versión compartida.');
      }
      renderLibrary();
      renderEditor();
      const invalid = report?.invalid || 0;
      setSongMessage(invalid
        ? `${invalid} entradas locales no se pudieron importar. Los originales se conservan; revisá el formato antes de reintentar.`
        : 'Cancionero compartido actualizado.');
    } catch (error) {
      if (ticket === generation) {
        if (error.status === 401) {
          persistState();
          ready = false; authenticated = false; library = { songs: [] }; folders = [];
          currentSongId = null; currentRevision = null; songName = ''; blocks = cloneBlocks(DEFAULT_BLOCKS);
          savedSnapshot = serializeSongDraft({ name: songName, blocks });
          stop({ silent: true }); renderLibrary(); renderEditor();
        }
        setSongMessage(`${error.message} Tu edición y los originales locales se conservan. Usá Actualizar para reintentar.`);
      }
    } finally {
      if (ticket === generation) { refreshing = false; updateButtons(); }
    }
  }

  function loadRemoteSong(song) {
    currentSongId = song.id;
    currentRevision = song.revision;
    songFolderId = song.folderId;
    songName = song.name;
    blocks = cloneBlocks(song.blocks);
    savedSnapshot = serializeSongDraft(song);
    runtime = createPlaybackRuntime(playbackBlocks());
    dom.bpm.value = String(blocks[0].bpm);
    renderPlayback();
  }

  async function mutateLibrary(operation) {
    if (saving || !authenticated || !ready) return;
    saving = true;
    const ticket = generation;
    const isCurrent = () => ticket === generation && authenticated;
    mutationVersion++;
    updateButtons();
    try { await operation(isCurrent); }
    catch (error) { if (isCurrent()) { setSongMessage(error.message); setStatus(error.message); } }
    finally { if (ticket === generation) { saving = false; updateButtons(); } }
  }

  async function moveSong(song, folderId) {
    if (folderId === (song.folderId || null)) return;
    await mutateLibrary(async (isCurrent) => {
      const response = await songbook.mutate({ action: 'updateSong', song: { ...song, folderId, revision: currentSongId === song.id ? currentRevision : song.revision } });
      if (!isCurrent()) return;
      library.songs = library.songs.map(item => item.id === song.id ? response.song : item);
      if (currentSongId === song.id) { songFolderId = folderId; currentRevision = response.song.revision; }
      persistState();
      renderLibrary();
      setSongMessage('Canción movida. Se conserva su contenido y configuración.');
    });
  }

  async function editFolder(folder = null) {
    if (!authenticated || !ready || saving) return;
    const name = await requestName({ title: folder ? 'Renombrar carpeta' : 'Nueva carpeta', copy: 'La carpeta se comparte con todos los usuarios.', initialValue: folder?.name || pendingFolderCreation?.name || '' });
    if (name === null) return;
    await mutateLibrary(async (isCurrent) => {
      if (!folder && pendingFolderCreation?.name !== name) pendingFolderCreation = { id: globalThis.crypto.randomUUID(), name };
      if (!folder) persistState();
      const response = await songbook.mutate({ action: folder ? 'renameFolder' : 'createFolder', id: folder?.id || pendingFolderCreation.id, revision: folder?.revision, name });
      if (!isCurrent()) return;
      folders = [...folders.filter(item => item.id !== response.folder.id), response.folder];
      if (!folder) { pendingFolderCreation = null; persistState(); }
      renderLibrary();
      setSongMessage(folder ? 'Carpeta renombrada.' : 'Carpeta creada.');
    });
  }

  async function handleFolderClick(event) {
    if (saving) return;
    const button = event.target.closest('[data-folder-action]');
    const folder = folders.find(item => item.id === button?.dataset.folderId);
    if (!folder) return;
    if (button.dataset.folderAction === 'open') { activeFolderId = folder.id; renderLibrary(); }
    if (button.dataset.folderAction === 'rename') await editFolder(folder);
    if (button.dataset.folderAction === 'delete') {
      const confirmed = await requestConfirm({ title: 'Eliminar carpeta', copy: `Se elimina "${folder.name}" para todos. Sus canciones se moverán a Canciones sin carpeta.`, confirmText: 'Eliminar carpeta' });
      if (!confirmed) return;
      await mutateLibrary(async (isCurrent) => {
        const previousRevision = getCurrentSong()?.revision;
        await songbook.mutate({ action: 'deleteFolder', id: folder.id, revision: folder.revision, confirmed: true });
        const response = await songbook.list();
        if (!isCurrent()) return;
        folders = response.folders;
        library = { songs: response.songs };
        if (songFolderId === folder.id) {
          songFolderId = null;
          const latest = getCurrentSong();
          if (previousRevision === currentRevision && latest?.revision === previousRevision + 1 && serializeSongDraft(latest) === savedSnapshot) currentRevision = latest.revision;
        }
        persistState();
        renderLibrary();
        setSongMessage('Carpeta eliminada. Sus canciones están en la raíz.');
      });
    }
  }

  function handleBlockListClick(event) {
    const nameButton = event.target.closest('[data-part-name-button]');
    if (nameButton) {
      startNameEdit(Number(nameButton.closest('[data-metronome-block-row]').dataset.blockIndex));
      return;
    }

    const nameAction = event.target.closest('[data-part-name-action]');
    if (nameAction) {
      const index = Number(nameAction.closest('[data-metronome-block-row]').dataset.blockIndex);
      if (nameAction.dataset.partNameAction === 'accept') {
        commitNameEdit(index);
      } else {
        cancelNameEdit();
      }
      return;
    }

    const button = event.target.closest('[data-block-action]');
    if (!button) {
      return;
    }

    syncBlocksFromDom();
    const row = button.closest('[data-metronome-block-row]');
    const index = Number(row.dataset.blockIndex);
    const action = button.dataset.blockAction;

    if (action === 'remove') {
      if (blocks.length === 1) {
        setConfigError('La canción debe tener al menos una parte.');
        return;
      }
      blocks.splice(index, 1);
    }
    if (action === 'up' && index > 0) {
      [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]];
    }
    if (action === 'down' && index < blocks.length - 1) {
      [blocks[index + 1], blocks[index]] = [blocks[index], blocks[index + 1]];
    }

    blocks = blocks.map((block, itemIndex) => ({ ...block, order: itemIndex }));
    editingPartIndex = null;
    renderEditableBlocks();
    renderEditor();
  }

  function handleBlockListInput(event) {
    if (saving) return;
    const input = event.target.closest('[data-block-measures], [data-block-bpm], [data-ramp-enabled], [data-ramp-bpm], [data-ramp-measures]');
    if (!input) {
      return;
    }
    syncBlocksFromDom();
    clearConfigError();
    renderEditor();
    persistState();
  }

  function handleBlockListKeydown(event) {
    const input = event.target.closest('[data-part-name-input]');
    if (!input) {
      return;
    }
    const index = Number(input.closest('[data-metronome-block-row]').dataset.blockIndex);
    if (event.key === 'Enter') {
      event.preventDefault();
      commitNameEdit(index);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelNameEdit();
    }
  }

  function startNameEdit(index) {
    syncBlocksFromDom();
    editingPartIndex = index;
    renderEditableBlocks();
    focusPartNameInput(index);
  }

  function commitNameEdit(index = editingPartIndex) {
    if (!Number.isInteger(index) || index < 0 || index >= blocks.length) {
      editingPartIndex = null;
      return true;
    }

    const input = dom.blockList.querySelector(`[data-block-index="${index}"] [data-part-name-input]`);
    if (!input) {
      editingPartIndex = null;
      return true;
    }

    const parsed = parsePartName(input.value);
    if (!parsed.ok) {
      setConfigError(parsed.message);
      input.focus();
      return false;
    }

    blocks[index] = {
      ...blocks[index],
      name: parsed.value,
      order: index
    };
    editingPartIndex = null;
    clearConfigError();
    renderEditableBlocks();
    renderEditor();
    persistState();
    return true;
  }

  function commitPendingNameEdit() {
    return editingPartIndex === null ? true : commitNameEdit(editingPartIndex);
  }

  function cancelNameEdit() {
    editingPartIndex = null;
    clearConfigError();
    renderEditableBlocks();
  }

  function syncBlocksFromDom() {
    const rows = [...dom.blockList.querySelectorAll('[data-metronome-block-row]')];
    if (rows.length === 0 && blocks.length === 0) {
      return;
    }

    blocks = rows.map((row) => {
      const index = Number(row.dataset.blockIndex);
      const nameInput = row.querySelector('[data-part-name-input]');
      return {
        id: row.dataset.blockId || blocks[index]?.id || createId('part'),
        name: nameInput ? nameInput.value : blocks[index]?.name || row.querySelector('[data-part-name-button]')?.textContent || `Parte ${index + 1}`,
        measures: row.querySelector('[data-block-measures]')?.value ?? blocks[index]?.measures ?? '4',
        bpm: row.querySelector('[data-block-bpm]')?.value ?? blocks[index]?.bpm ?? String(currentBpm()),
        ramp: row.querySelector('[data-ramp-enabled]') ? {
          enabled: row.querySelector('[data-ramp-enabled]').checked,
          targetBpm: row.querySelector('[data-ramp-bpm]').value,
          measures: row.querySelector('[data-ramp-measures]').value
        } : blocks[index]?.ramp,
        order: index
      };
    });
  }

  function renderAll() {
    renderPlayback();
    renderEditor();
    renderLibrary();
    if (!dom.dialog.hidden) {
      renderEditableBlocks();
    }
    renderVoiceOptions();
    updateButtons();
  }

  function renderPlayback() {
    const currentBlocks = playbackBlocks();
    const currentBlock = getCurrentBlock(runtime, currentBlocks);
    const nextBlock = getNextBlock(runtime, currentBlocks);
    const song = getCurrentSong();
    const isInitialCountIn = runtime.phase === 'countIn';
    const announcementWord = getAnnouncementWord(runtime, currentBlocks);

    dom.songNow.textContent = songName || song?.name || 'Sin guardar';
    dom.partNow.textContent = currentBlock.name;
    dom.nextPart.textContent = isInitialCountIn ? currentBlock.name : nextBlock.name;
    dom.incomingBpm.textContent = String(isInitialCountIn ? currentBlock.bpm : nextBlock.bpm);
    dom.bpmNow.textContent = String(Math.round(getPlaybackBpm(runtime, currentBlocks) * 10) / 10);
    dom.block.textContent = `${runtime.blockIndex + 1}/${currentBlocks.length}`;

    if (runtime.phase === 'countIn') {
      dom.announcement.textContent = `Próximo: ${currentBlock.name}`;
      dom.count.textContent = running ? announcementWord || 'Listo' : 'Listo';
      dom.pulse.textContent = running ? `${5 - runtime.countInBeat}/4` : '-/4';
      dom.measure.textContent = running ? 'Cuenta inicial' : 'Inicio';
      return;
    }

    dom.announcement.textContent = announcementWord ? `Próximo: ${nextBlock.name}` : `Tocando: ${currentBlock.name}`;
    dom.count.textContent = String(runtime.beatInMeasure);
    dom.pulse.textContent = `${runtime.beatInMeasure}/${BEATS_PER_MEASURE}`;
    dom.measure.textContent = `${runtime.measureInBlock}/${currentBlock.measures}`;
  }

  function renderEditor() {
    const song = getCurrentSong();
    const blockCount = blocks.length;
    dom.currentSong.textContent = song ? `${song.name} · ${song.blocks.length} partes` : songName ? `${songName} · ${blockCount} partes` : 'Configuración suelta';
    dom.unsaved.hidden = !isDirty();
    if (!dom.dialog.hidden) {
      dom.songName.value = songName;
    }
  }

  function renderEditableBlocks() {
    const rows = blocks.map((block, index) => createPartCard(block, index));
    dom.blockList.replaceChildren(...rows);
    dom.partCount.textContent = `${blocks.length} de ${MAX_PARTS} partes`;
    dom.addBlock.disabled = saving || blocks.length >= MAX_PARTS;
  }

  function createPartCard(block, index) {
    const row = document.createElement('article');
    row.className = 'metronome-block-row metronome-part-card';
    row.dataset.metronomeBlockRow = '';
    row.dataset.blockIndex = String(index);
    row.dataset.blockId = block.id || '';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'part-name-wrap';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'compact-label';
    nameLabel.textContent = 'Nombre de la parte';
    nameWrap.append(nameLabel);

    if (editingPartIndex === index) {
      const editGroup = document.createElement('div');
      editGroup.className = 'part-name-edit';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 40;
      input.value = block.name;
      input.autocomplete = 'off';
      input.dataset.partNameInput = '';
      input.addEventListener('blur', () => {
        window.setTimeout(() => {
          const active = document.activeElement;
          if (!row.contains(active)) {
            commitNameEdit(index);
          }
        }, 0);
      });
      editGroup.append(input, createPartNameAction('Aceptar', 'accept'), createPartNameAction('Cancelar', 'cancel'));
      nameWrap.append(editGroup);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'part-name-button';
      button.dataset.partNameButton = '';
      button.textContent = block.name;
      nameWrap.append(button);
    }

    row.append(
      nameWrap,
      createPartField('Compases', 'data-block-measures', block.measures),
      createPartField('BPM', 'data-block-bpm', block.bpm),
      createIconButton('Subir', 'up', index === 0),
      createIconButton('Bajar', 'down', index === blocks.length - 1),
      createIconButton('Eliminar', 'remove', blocks.length === 1)
    );
    const ramp = document.createElement('div');
    ramp.className = 'part-ramp';
    const label = document.createElement('label');
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.dataset.rampEnabled = '';
    enabled.checked = block.ramp?.enabled === true;
    label.append(enabled, document.createTextNode(' Aceleración progresiva'));
    ramp.append(label,
      createPartField('BPM objetivo', 'data-ramp-bpm', block.ramp?.targetBpm ?? block.bpm),
      createPartField('Compases de transición', 'data-ramp-measures', block.ramp?.measures ?? 1));
    const help = document.createElement('small');
    help.textContent = 'Desde el BPM de esta parte. Al terminar, mantiene el objetivo hasta la próxima parte.';
    ramp.append(help);
    row.append(ramp);
    return row;
  }

  function createPartField(label, dataAttribute, value) {
    const wrapper = document.createElement('label');
    wrapper.className = 'compact-field';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.value = String(value ?? '');
    input.setAttribute(dataAttribute, '');
    wrapper.append(span, input);
    return wrapper;
  }

  function createPartNameAction(label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.dataset.partNameAction = action;
    button.setAttribute('aria-label', label);
    button.textContent = action === 'accept' ? '✓' : '×';
    return button;
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

  function renderLibrary() {
    const songs = library.songs.filter(song => (song.folderId || null) === activeFolderId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const folder = folders.find(item => item.id === activeFolderId);
    dom.folderBack.hidden = !activeFolderId;
    dom.folderTitle.textContent = folder?.name || 'Canciones sin carpeta';
    dom.folderList.hidden = !!activeFolderId;
    dom.folderList.replaceChildren(...folders.slice().sort((a, b) => a.name.localeCompare(b.name, 'es-AR')).map(createFolderCard));
    dom.libraryCopy.textContent = authenticated ? 'Canciones y carpetas compartidas entre usuarios autenticados.' : 'Canciones locales originales. El cancionero compartido requiere sesión online.';
    dom.songEmpty.hidden = songs.length > 0;
    dom.songList.replaceChildren(...songs.map(createSongCard));
  }

  function createFolderCard(folder) {
    const card = document.createElement('article');
    card.className = 'song-card folder-card';
    const title = document.createElement('strong');
    title.textContent = `📁 ${folder.name}`;
    const count = document.createElement('span');
    count.textContent = `${library.songs.filter(song => song.folderId === folder.id).length} canciones`;
    const actions = document.createElement('div');
    actions.className = 'song-actions';
    for (const [label, action] of [['Abrir', 'open'], ['Renombrar', 'rename'], ['Eliminar', 'delete']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action === 'delete' ? 'danger-button' : 'quiet-button';
      button.textContent = label;
      button.dataset.folderAction = action;
      button.dataset.folderId = folder.id;
      button.disabled = saving || !ready;
      actions.append(button);
    }
    card.append(title, count, actions);
    return card;
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
    count.textContent = `${song.blocks.length} partes`;
    head.append(titleWrap, count);

    const actions = document.createElement('div');
    actions.className = 'song-actions';
    actions.append(
      createSongButton('Abrir', 'open', song.id, 'quiet-button'),
      createSongButton('Renombrar', 'rename', song.id, 'quiet-button'),
      createSongButton('Eliminar', 'delete', song.id, 'danger-button')
    );
    if (authenticated) {
      const label = document.createElement('label');
      label.className = 'compact-field song-folder';
      const text = document.createElement('span');
      text.textContent = 'Mover a';
      const select = document.createElement('select');
      select.dataset.songFolder = '';
      select.setAttribute('aria-label', `Carpeta de ${song.name}`);
      for (const folder of [{ id: '', name: 'Canciones sin carpeta' }, ...folders]) {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        select.append(option);
      }
      select.value = song.folderId || '';
      select.disabled = saving || !ready;
      label.append(text, select);
      actions.append(label, createSongButton('Mover', 'move', song.id, 'quiet-button'));
    }

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
    button.disabled = saving || (action !== 'open' && (!authenticated || !ready));
    return button;
  }

  function renderVoiceOptions() {
    const voices = speech.voices;
    const selected = dom.voiceSelect.value || speech.preferredVoice?.voiceURI || '';
    const options = [];
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = voices.length ? 'Automática' : 'Sin voces disponibles';
    options.push(auto);

    for (const voice of voices) {
      const option = document.createElement('option');
      option.value = voice.voiceURI || voice.name;
      option.textContent = `${voice.name} (${voice.lang || 'sin idioma'})`;
      options.push(option);
    }

    dom.voiceSelect.replaceChildren(...options);
    if ([...dom.voiceSelect.options].some((option) => option.value === selected)) {
      dom.voiceSelect.value = selected;
    }
  }

  async function testVoice() {
    const settings = {
      voiceURI: dom.voiceSelect.value,
      volume: Number(dom.voiceVolume.value) || DEFAULT_VOICE_VOLUME
    };
    const result = await speech.speak('Prueba de voz', { ...settings, rate: 1.05, timeoutMs: 1800, cancelPrevious: true });
    setStatus(result ? 'Prueba de voz enviada.' : 'La voz no está disponible; el metrónomo sigue funcionando.');
  }

  function requestName({ title, copy, initialValue = '', confirmText = 'Guardar' }) {
    if (pendingNameDialog) {
      return Promise.resolve(null);
    }

    const trigger = document.activeElement;
    dom.nameTitle.textContent = title;
    dom.nameCopy.textContent = copy;
    dom.nameInput.value = initialValue;
    dom.nameError.textContent = '';
    dom.nameConfirm.textContent = confirmText;
    dom.nameDialog.hidden = false;
    dom.nameInput.focus();
    dom.nameInput.select();

    return new Promise((resolve) => {
      pendingNameDialog = { resolve, trigger };
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

    const { resolve, trigger } = pendingNameDialog;
    pendingNameDialog = null;
    dom.nameDialog.hidden = true;
    dom.nameInput.value = '';
    dom.nameError.textContent = '';
    if (trigger?.isConnected && typeof trigger.focus === 'function') {
      trigger.focus();
    }
    resolve(value);
  }

  function requestConfirm({ title, copy, confirmText = 'Confirmar' }) {
    if (pendingConfirmDialog) {
      return Promise.resolve(false);
    }

    const trigger = document.activeElement;
    dom.confirmTitle.textContent = title;
    dom.confirmCopy.textContent = copy;
    dom.confirmAccept.textContent = confirmText;
    dom.confirmDialog.hidden = false;
    dom.confirmCancel.focus();

    return new Promise((resolve) => {
      pendingConfirmDialog = { resolve, trigger };
    });
  }

  function closeConfirmDialog(value) {
    if (!pendingConfirmDialog) {
      return;
    }

    const { resolve, trigger } = pendingConfirmDialog;
    pendingConfirmDialog = null;
    dom.confirmDialog.hidden = true;
    if (trigger?.isConnected && typeof trigger.focus === 'function') {
      trigger.focus();
    }
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
      cancelConfigChanges();
    }
  }

  function updateButtons() {
    const playbackState = running ? (paused ? 'paused' : 'playing') : 'stopped';
    root.dataset.playbackState = playbackState;
    dom.transportState.textContent =
      playbackState === 'playing' ? 'En marcha' : playbackState === 'paused' ? 'En pausa' : 'Detenido';
    dom.start.disabled = running || startingAudio;
    dom.pause.disabled = !running || startingAudio;
    dom.pause.textContent = paused ? 'Reanudar' : 'Pausar';
    dom.stop.disabled = !running && !startingAudio;
    if (dom.restart) {
      dom.restart.disabled = false;
    }
    dom.saveSong.disabled = saving || !authenticated || !ready;
    dom.saveSongAs.disabled = saving || !authenticated || !ready;
    dom.save.disabled = saving || !authenticated || !ready;
    dom.saveBlocksAs.disabled = saving || !authenticated || !ready;
    dom.newFolder.disabled = saving || !authenticated || !ready;
    dom.refresh.disabled = saving || refreshing || !authenticated;
    dom.newSong.disabled = saving;
    dom.configure.disabled = saving;
    dom.cancel.disabled = saving;
    dom.songName.disabled = saving;
    dom.bpm.disabled = saving;
    dom.tap.disabled = saving;
    dom.restore.disabled = saving;
    for (const input of dom.blockList.querySelectorAll('input,button')) input.disabled = saving;
    for (const row of dom.blockList.querySelectorAll('[data-metronome-block-row]')) {
      const index = Number(row.dataset.blockIndex);
      row.querySelector('[data-block-action="up"]').disabled = saving || index === 0;
      row.querySelector('[data-block-action="down"]').disabled = saving || index === blocks.length - 1;
      row.querySelector('[data-block-action="remove"]').disabled = saving || blocks.length === 1;
    }
    for (const button of root.querySelectorAll('[data-song-action],[data-folder-action],[data-song-folder]')) button.disabled = saving || (button.dataset.songAction !== 'open' && (!authenticated || !ready));
    dom.addBlock.disabled = saving || blocks.length >= MAX_PARTS;
    dom.saveSong.textContent = saving ? 'Guardando...' : 'Guardar canción';
    dom.save.textContent = saving ? 'Guardando...' : 'Guardar canción';
  }

  function playbackBlocks() {
    const valid = validateEditableBlocks(blocks);
    return valid.ok ? valid.blocks : cloneBlocks(DEFAULT_BLOCKS);
  }

  function validatePlaybackDraft() {
    if (!dom.dialog.hidden) syncBlocksFromDom();
    if (!blocks.length) return true;
    const validation = validateEditableBlocks(blocks);
    if (validation.ok) return true;
    setConfigError(validation.message);
    return false;
  }

  function isDirty() {
    return serializeSongDraft({ name: songName, blocks }) !== savedSnapshot;
  }

  function getCurrentSong() {
    return currentSongId ? findSong(library, currentSongId) : null;
  }

  function currentBpm() {
    const parsed = parseBpm(dom.bpm.value);
    return parsed.ok ? parsed.value : DEFAULT_BPM;
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

  function persistState() {
    try { getStorage()?.setItem(
      scopedStorageKey(STORAGE_KEY),
      JSON.stringify({
        assetVersion: ASSET_VERSION,
        bpm: currentBpm(),
        volume: Number(dom.volume.value),
        blocks,
        currentSongId,
        currentRevision,
        songFolderId,
        savedSnapshot,
        pendingCreate,
        pendingFolderCreation,
        songName,
        sharedSong: authenticated && currentRevision !== null,
        announceParts: dom.announceParts.checked,
        voiceURI: dom.voiceSelect.value,
        voiceVolume: Number(dom.voiceVolume.value)
      })
    ); } catch { setSongMessage('No se pudieron guardar las preferencias en este dispositivo. El cancionero compartido conserva los guardados confirmados por el servidor.'); }
  }

  function focusPartNameInput(index) {
    const input = dom.blockList.querySelector(`[data-block-index="${index}"] [data-part-name-input]`);
    input?.focus();
    input?.select?.();
  }

  function focusEditableField(validation) {
    const row = dom.blockList.querySelector(`[data-block-index="${validation.index}"]`);
    const selector = validation.field === 'name' ? '[data-part-name-button]' : `[data-block-${validation.field}]`;
    row?.querySelector(selector)?.focus();
  }

  function setConfigError(message) {
    dom.error.textContent = message;
    if (dom.dialog.hidden) {
      setStatus(message);
    }
  }

  function clearConfigError() {
    dom.error.textContent = '';
  }

  function setStatus(message) {
    dom.status.textContent = message;
  }

  function setSongMessage(message) {
    dom.songMessage.textContent = message;
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
    setSession,
    refresh: refreshLibrary,
    destroy: () => { stop({ silent: true }); getBrowserWindow().clearInterval(refreshTimer); },
    getState: () => ({
      blocks: cloneBlocks(blocks),
      runtime: { ...runtime },
      running,
      paused,
      currentSongId,
      songName,
      songs: cloneSongs(library.songs),
      dirty: isDirty()
    })
  };
}

export class MetronomeAudio {
  constructor({ speech, getSpeechSettings, onBeat, onCountIn, onStatus }) {
    this.speech = speech;
    this.getSpeechSettings = getSpeechSettings;
    this.onBeat = onBeat;
    this.onCountIn = onCountIn;
    this.onStatus = onStatus;
    this.context = null;
    this.gain = null;
    this.timer = null;
    this.nextNoteTime = 0;
    this.runtime = null;
    this.blocks = [];
    this.volume = DEFAULT_VOLUME;
    this.sequence = 0;
    this.scheduledNodes = new Set();
    this.scheduledCallbacks = new Set();
    this.pendingBeats = new Map();
    this.startPromise = null;
    this.resumeRuntime = null;
    this.pauseDelay = 0.05;
  }

  setVolume(value) {
    this.volume = value;
    if (this.gain) {
      this.gain.gain.value = value;
    }
  }

  async start({ runtime, blocks }) {
    if (this.timer || this.startPromise) {
      return false;
    }

    const sequence = ++this.sequence;
    this.runtime = { ...runtime };
    this.blocks = normalizeBlocks(blocks);
    this.resumeRuntime = null;
    this.pauseDelay = 0.05;
    const browserWindow = getBrowserWindow();
    const AudioContextClass = browserWindow.AudioContext || browserWindow.webkitAudioContext;
    if (!AudioContextClass) {
      this.onStatus('Este navegador no soporta Web Audio API.');
      return false;
    }

    try {
      if (!this.context) {
        this.context = new AudioContextClass();
        this.gain = this.context.createGain();
        this.gain.gain.value = this.volume;
        this.gain.connect(this.context.destination);
      }
    } catch {
      this.context = null;
      this.gain = null;
      this.onStatus('No se pudo abrir el audio. Tocá Iniciar para volver a intentar.');
      return false;
    }

    const attempt = (async () => {
      try {
        await this.context.resume?.();
      } catch {
        if (sequence === this.sequence) {
          this.onStatus('No se pudo iniciar el audio. Tocá Iniciar para volver a intentar.');
        }
        return false;
      }
      if (sequence !== this.sequence) {
        return false;
      }
      this.beginPhase(sequence);
      return Boolean(this.timer);
    })();
    this.startPromise = attempt;
    try {
      return await attempt;
    } finally {
      if (this.startPromise === attempt) {
        this.startPromise = null;
      }
    }
  }

  pause() {
    const now = this.context?.currentTime || 0;
    const nextPending = [...this.pendingBeats.values()].find((beat) => beat.time > now);
    this.resumeRuntime = { ...(nextPending?.runtime || this.runtime) };
    this.pauseDelay = Math.max(0, (nextPending?.time ?? this.nextNoteTime) - now);
    this.sequence += 1;
    this.startPromise = null;
    this.clearTimers();
    this.speech.cancel();
    this.stopScheduledClicks();
  }

  async resume({ runtime, blocks }) {
    if (this.timer || this.startPromise || !this.context) {
      return false;
    }
    this.runtime = { ...(this.resumeRuntime || runtime) };
    this.blocks = normalizeBlocks(blocks);
    const sequence = ++this.sequence;
    const attempt = (async () => {
      try {
        await this.context.resume?.();
      } catch {
        if (sequence === this.sequence) {
          this.onStatus('No se pudo reanudar el audio.');
        }
        return false;
      }
      if (sequence !== this.sequence) {
        return false;
      }
      this.beginPhase(sequence, this.pauseDelay);
      return Boolean(this.timer);
    })();
    this.startPromise = attempt;
    try {
      return await attempt;
    } finally {
      if (this.startPromise === attempt) {
        this.startPromise = null;
      }
    }
  }

  stop() {
    this.sequence += 1;
    this.pause();
    this.nextNoteTime = 0;
    this.runtime = null;
    this.resumeRuntime = null;
  }

  async restart({ runtime, blocks }) {
    this.stop();
    return this.start({ runtime, blocks });
  }

  beginPhase(sequence, delay = 0.05) {
    if (!this.context || !this.runtime || sequence !== this.sequence) {
      return;
    }

    this.clearTimers();
    this.nextNoteTime = this.context.currentTime + delay;
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
    // After a suspended/background tab, skip expired pulses instead of
    // scheduling a burst of clicks in the past.
    while (this.timer && this.nextNoteTime < this.context.currentTime) {
      this.nextNoteTime += getPlaybackInterval(this.runtime, this.blocks);
      this.runtime = advancePlaybackRuntime(this.runtime, this.blocks);
    }
    while (this.timer && this.nextNoteTime < this.context.currentTime + SCHEDULE_AHEAD_SECONDS) {
      const scheduledRuntime = { ...this.runtime };
      scheduledRuntime.bpm = getPlaybackBpm(scheduledRuntime, this.blocks);
      const scheduledTime = this.nextNoteTime;
      const callbackDelay = Math.max(0, (scheduledTime - this.context.currentTime) * 1000);
      const accented = scheduledRuntime.phase === 'playing' && scheduledRuntime.beatInMeasure === 1;
      this.scheduleClick(scheduledTime, accented);

      const callbackId = browserWindow.setTimeout(() => {
        this.scheduledCallbacks.delete(callbackId);
        this.pendingBeats.delete(callbackId);
        if (sequence !== this.sequence) {
          return;
        }
        if (scheduledTime + getPlaybackInterval(scheduledRuntime, this.blocks) <= this.context.currentTime) {
          return;
        }
        const announcementWord = getAnnouncementWord(scheduledRuntime, this.blocks);
        if (scheduledRuntime.phase === 'countIn') {
          this.onCountIn(scheduledRuntime);
        } else {
          this.onBeat(scheduledRuntime);
        }
        this.speakScheduledWord(announcementWord);
      }, callbackDelay);
      this.scheduledCallbacks.add(callbackId);
      this.pendingBeats.set(callbackId, { runtime: scheduledRuntime, time: scheduledTime });

      this.runtime = advancePlaybackRuntime(this.runtime, this.blocks);
      this.nextNoteTime += getPlaybackInterval(scheduledRuntime, this.blocks);
    }
  }

  speakScheduledWord(word) {
    const settings = this.getSpeechSettings();
    if (!word || !settings.announceParts) {
      return;
    }

    this.speech.speak(word, {
      voiceURI: settings.voiceURI,
      volume: settings.volume,
      rate: word.length > 12 ? 1.25 : 1.45,
      timeoutMs: 650,
      cancelPrevious: true
    }).catch(() => {
      this.onStatus('La voz no está disponible; continúo con clicks y cuenta visual.');
    });
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
    const browserWindow = getBrowserWindow();
    for (const callbackId of this.scheduledCallbacks) {
      browserWindow.clearTimeout(callbackId);
    }
    this.scheduledCallbacks.clear();
    this.pendingBeats.clear();
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
  constructor({ onVoicesChanged, onError }) {
    const browserWindow = getBrowserWindow();
    this.synthesis = browserWindow.speechSynthesis || null;
    this.Utterance = browserWindow.SpeechSynthesisUtterance || null;
    this.voices = [];
    this.preferredVoice = null;
    this.onVoicesChanged = onVoicesChanged;
    this.onError = onError;
    if (this.synthesis) {
      this.refreshVoices();
      if (typeof this.synthesis.addEventListener === 'function') {
        this.synthesis.addEventListener('voiceschanged', () => {
          this.refreshVoices();
          this.onVoicesChanged?.();
        });
      } else if ('onvoiceschanged' in this.synthesis) {
        this.synthesis.onvoiceschanged = () => {
          this.refreshVoices();
          this.onVoicesChanged?.();
        };
      }
    }
  }

  get available() {
    return Boolean(this.synthesis && this.Utterance);
  }

  refreshVoices(preferredVoiceURI = '') {
    this.voices = this.synthesis?.getVoices?.() || [];
    this.preferredVoice = selectPreferredVoice(this.voices, preferredVoiceURI);
    return this.voices;
  }

  speak(text, { voiceURI = '', rate = 1, volume = 1, timeoutMs = 1800, cancelPrevious = true } = {}) {
    if (!this.available || !text) {
      return Promise.resolve(false);
    }

    this.refreshVoices(voiceURI);
    if (cancelPrevious) {
      this.cancel();
    }

    const browserWindow = getBrowserWindow();
    return new Promise((resolve) => {
      const utterance = new this.Utterance(text);
      const voice = selectPreferredVoice(this.voices, voiceURI);
      utterance.lang = voice?.lang || 'es-AR';
      if (voice) {
        utterance.voice = voice;
      }
      utterance.rate = rate;
      utterance.pitch = 1;
      utterance.volume = Math.min(1, Math.max(0, volume));

      let finished = false;
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

      utterance.onstart = () => {};
      utterance.onend = () => finish(true);
      utterance.onerror = () => {
        this.onError?.('La voz falló; continúo sin anuncios hablados.');
        finish(false);
      };

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

function collectDom(root) {
  return {
    bpm: root.querySelector('#metronome-bpm'),
    start: root.querySelector('#metronome-start'),
    pause: root.querySelector('#metronome-pause'),
    stop: root.querySelector('#metronome-stop'),
    restart: root.querySelector('#metronome-restart'),
    tap: root.querySelector('#metronome-tap'),
    volume: root.querySelector('#metronome-volume'),
    status: root.querySelector('#metronome-status'),
    transportState: root.querySelector('#metronome-transport-state'),
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
    refresh: root.querySelector('#metronome-refresh'),
    newFolder: root.querySelector('#metronome-new-folder'),
    folderBack: root.querySelector('#metronome-folder-back'),
    folderTitle: root.querySelector('#metronome-folder-title'),
    folderList: root.querySelector('#metronome-folder-list'),
    libraryCopy: root.querySelector('#metronome-library-copy'),
    dialog: document.querySelector('#metronome-config-dialog'),
    songName: document.querySelector('#metronome-song-name'),
    partCount: document.querySelector('#metronome-part-count'),
    blockList: document.querySelector('#metronome-block-list'),
    addBlock: document.querySelector('#metronome-add-block'),
    restore: document.querySelector('#metronome-restore-blocks'),
    save: document.querySelector('#metronome-save-blocks'),
    saveBlocksAs: document.querySelector('#metronome-save-blocks-as'),
    cancel: document.querySelector('#metronome-cancel-blocks'),
    error: document.querySelector('#metronome-config-error'),
    announceParts: document.querySelector('#metronome-announce-parts'),
    voiceSelect: document.querySelector('#metronome-voice-select'),
    voiceVolume: document.querySelector('#metronome-voice-volume'),
    testVoice: document.querySelector('#metronome-test-voice'),
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
}

function readState() {
  try {
    const parsed = JSON.parse(getStorage()?.getItem(scopedStorageKey(STORAGE_KEY)));
    const bpm = Number.isInteger(parsed?.bpm) && parseBpm(String(parsed.bpm)).ok ? parsed.bpm : DEFAULT_BPM;
    const volume = Number.isFinite(parsed?.volume) ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULT_VOLUME;
    const voiceVolume = Number.isFinite(parsed?.voiceVolume) ? Math.min(1, Math.max(0, parsed.voiceVolume)) : DEFAULT_VOICE_VOLUME;
    return {
      bpm,
      volume,
      voiceVolume,
      announceParts: parsed?.announceParts !== false,
      voiceURI: typeof parsed?.voiceURI === 'string' ? parsed.voiceURI : '',
      blocks: Array.isArray(parsed?.blocks) && parsed.blocks.length <= MAX_PARTS ? cloneBlocks(parsed.blocks) : cloneBlocks(DEFAULT_BLOCKS),
      songName: typeof parsed?.songName === 'string' ? parsed.songName : '',
      savedSnapshot: typeof parsed?.savedSnapshot === 'string' ? parsed.savedSnapshot : null,
      currentRevision: Number.isSafeInteger(parsed?.currentRevision) ? parsed.currentRevision : null,
      pendingCreate: typeof parsed?.pendingCreate?.id === 'string' && typeof parsed?.pendingCreate?.snapshot === 'string' ? parsed.pendingCreate : null,
      pendingFolderCreation: typeof parsed?.pendingFolderCreation?.id === 'string' && typeof parsed?.pendingFolderCreation?.name === 'string' ? parsed.pendingFolderCreation : null,
      songFolderId: typeof parsed?.songFolderId === 'string' ? parsed.songFolderId : null,
      currentSongId: typeof parsed?.currentSongId === 'string' ? parsed.currentSongId : null,
      sharedSong: parsed?.sharedSong === true
    };
  } catch {
    return {
      bpm: DEFAULT_BPM,
      volume: DEFAULT_VOLUME,
      voiceVolume: DEFAULT_VOICE_VOLUME,
      announceParts: true,
      voiceURI: '',
      blocks: cloneBlocks(DEFAULT_BLOCKS),
      songName: '',
      savedSnapshot: null,
      currentRevision: null,
      pendingCreate: null,
      pendingFolderCreation: null,
      songFolderId: null,
      currentSongId: null
    };
  }
}

function readLibrary() {
  try {
    const storage = getStorage();
    const raw =
      storage?.getItem(scopedStorageKey(SONGS_STORAGE_KEY)) ||
      storage?.getItem(scopedStorageKey(OLD_SONGS_STORAGE_KEY));
    if (!raw) {
      return {
        library: sanitizeSongLibrary({ songs: [] }),
        discardedCount: 0,
        migratedCount: 0
      };
    }

    const parsed = JSON.parse(raw);
    const library = sanitizeSongLibrary(parsed);
    return {
      library,
      discardedCount: library.discardedCount,
      migratedCount: library.migratedCount
    };
  } catch {
    return {
      library: sanitizeSongLibrary({ songs: [] }),
      discardedCount: 1,
      migratedCount: 0
    };
  }
}

function cloneBlocks(blocks) {
  return Array.isArray(blocks) ? blocks.map((block, index) => ({ ...block, ...(block.ramp ? { ramp: { ...block.ramp } } : {}), order: index })) : [];
}

function cloneSongs(songs) {
  return songs.map((song) => ({
    ...song,
    blocks: cloneBlocks(song.blocks)
  }));
}

function findSong(library, songId) {
  return library.songs.find(song => song.id === songId) || null;
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

function getBrowserWindow() {
  return globalThis.window || globalThis;
}
