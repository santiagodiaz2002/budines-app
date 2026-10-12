import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync('public/index.html', 'utf8');

let windowRef;
let uuidIndex;
let sharedServer;
let instances;

beforeEach(() => {
  uuidIndex = 0;
  sharedServer = createSharedServer();
  instances = [];
  setupWindow();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const instance of instances) instance.destroy?.();
  vi.unstubAllGlobals();
  windowRef?.close();
});

describe('interfaz del metrónomo con canciones', () => {
  it('agrega partes, edita nombres inline, guarda y recupera una canción tras recarga', async () => {
    const metronome = await init();

    click('#metronome-new-song');
    await waitFor(() => !document.querySelector('#metronome-config-dialog').hidden);
    expect(document.querySelector('#metronome-config-dialog').hidden).toBe(false);

    click('#metronome-add-block');
    expect(document.querySelector('#metronome-part-count').textContent).toBe('1 de 32 partes');
    expect(document.querySelector('[data-part-name-button]').textContent).toBe('Parte 1');

    click('[data-part-name-button]');
    const nameInput = document.querySelector('[data-part-name-input]');
    nameInput.value = 'Intro';
    nameInput.dispatchEvent(new windowRef.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.querySelector('[data-part-name-button]').textContent).toBe('Intro');

    click('[data-part-name-button]');
    const canceledName = document.querySelector('[data-part-name-input]');
    canceledName.value = 'Puente';
    canceledName.dispatchEvent(new windowRef.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[data-part-name-button]').textContent).toBe('Intro');

    document.querySelector('[data-block-measures]').value = '2';
    document.querySelector('[data-block-bpm]').value = '80';
    document.querySelector('[data-block-measures]').dispatchEvent(new windowRef.Event('input', { bubbles: true }));

    click('#metronome-add-block');
    expect([...document.querySelectorAll('[data-part-name-button]')].at(-1).textContent).toBe('Parte 2');
    click([...document.querySelectorAll('[data-part-name-button]')].at(-1));
    const secondName = document.querySelector('[data-part-name-input]');
    secondName.value = 'Verso';
    secondName.dispatchEvent(new windowRef.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const rows = [...document.querySelectorAll('[data-metronome-block-row]')];
    rows[1].querySelector('[data-block-measures]').value = '2';
    rows[1].querySelector('[data-block-bpm]').value = '100';
    rows[1].querySelector('[data-block-bpm]').dispatchEvent(new windowRef.Event('input', { bubbles: true }));

    document.querySelector('#metronome-song-name').value = 'Tres Budines';
    document.querySelector('#metronome-song-name').dispatchEvent(new windowRef.Event('input', { bubbles: true }));
    click('#metronome-save-blocks');

    await waitFor(() => document.querySelectorAll('.song-card-title').length === 1);

    expect(document.querySelector('#metronome-status').textContent).toBe('Canción guardada.');
    expect(document.querySelectorAll('.song-card-title')).toHaveLength(1);
    expect(document.querySelector('.song-card-title').textContent).toBe('Tres Budines');
    expect(metronome.getState().dirty).toBe(false);

    const storageCopy = copyLocalStorage();
    setupWindow(storageCopy);
    await init();

    expect(document.querySelectorAll('.song-card')).toHaveLength(1);
    expect(document.querySelector('.song-card-title').textContent).toBe('Tres Budines');
  });

  it('deshabilita agregar parte al llegar a 32 y permite probar voz sin romper el metrónomo', async () => {
    await init();
    click('#metronome-new-song');
    await waitFor(() => !document.querySelector('#metronome-config-dialog').hidden);

    for (let index = 0; index < 32; index += 1) {
      click('#metronome-add-block');
    }

    expect(document.querySelectorAll('[data-metronome-block-row]')).toHaveLength(32);
    expect(document.querySelector('#metronome-part-count').textContent).toBe('32 de 32 partes');
    expect(document.querySelector('#metronome-add-block').disabled).toBe(true);
    expect(document.querySelector('#metronome-restart').textContent).toBe('Reiniciar');
    expect(document.querySelector('#metronome-restart').disabled).toBe(false);

    click('#metronome-test-voice');
    await waitFor(() => document.querySelector('#metronome-status').textContent.includes('voz'));
    expect(document.querySelector('#metronome-status').textContent).toContain('voz');
  });

  it('abre, actualiza sin duplicar, guarda como nueva, renombra y elimina canciones', async () => {
    await init();
    await createSavedSong('Cancion Base', [{ name: 'Intro', measures: '1', bpm: '90' }]);

    expect(songTitles()).toEqual(['Cancion Base']);

    document.querySelector('#metronome-song-name').value = 'Cancion Editada';
    document.querySelector('#metronome-song-name').dispatchEvent(new windowRef.Event('input', { bubbles: true }));
    click('#metronome-save-blocks');
    await waitFor(() => songTitles().includes('Cancion Editada'));
    expect(document.querySelectorAll('.song-card-title')).toHaveLength(1);

    document.querySelector('#metronome-song-name').value = 'Cancion Copia';
    document.querySelector('#metronome-song-name').dispatchEvent(new windowRef.Event('input', { bubbles: true }));
    click('#metronome-save-blocks-as');
    await waitFor(() => document.querySelectorAll('.song-card-title').length === 2);
    expect(songTitles().sort()).toEqual(['Cancion Copia', 'Cancion Editada']);

    click('#metronome-cancel-blocks');
    await waitFor(() => document.querySelector('#metronome-config-dialog').hidden);

    clickSongAction('Cancion Editada', 'open');
    await waitFor(() => document.querySelector('#metronome-song-now').textContent === 'Cancion Editada');

    clickSongAction('Cancion Copia', 'rename');
    await waitFor(() => !document.querySelector('#metronome-name-dialog').hidden);
    submitNameDialog('Copia Renombrada');
    await waitFor(() => songTitles().includes('Copia Renombrada'));

    clickSongAction('Cancion Editada', 'delete');
    await waitFor(() => !document.querySelector('#metronome-confirm-dialog').hidden);
    click('#metronome-confirm-cancel');
    await waitFor(() => document.querySelector('#metronome-confirm-dialog').hidden);
    expect(songTitles().sort()).toEqual(['Cancion Editada', 'Copia Renombrada']);

    clickSongAction('Cancion Editada', 'delete');
    await waitFor(() => !document.querySelector('#metronome-confirm-dialog').hidden);
    click('#metronome-confirm-accept');
    await waitFor(() => !songTitles().includes('Cancion Editada'));
    expect(songTitles()).toEqual(['Copia Renombrada']);
  });

  it('restaura el foco al cancelar diálogos de nombre y confirmación', async () => {
    await init();
    await createSavedSong('Canción con foco', [{ name: 'Intro', measures: '1', bpm: '90' }]);
    click('#metronome-cancel-blocks');
    await waitFor(() => document.querySelector('#metronome-config-dialog').hidden);

    const renameButton = songActionButton('Canción con foco', 'rename');
    renameButton.focus();
    click(renameButton);
    await waitFor(() => !document.querySelector('#metronome-name-dialog').hidden);
    click('#metronome-name-cancel');
    expect(document.activeElement).toBe(renameButton);

    const deleteButton = songActionButton('Canción con foco', 'delete');
    deleteButton.focus();
    click(deleteButton);
    await waitFor(() => !document.querySelector('#metronome-confirm-dialog').hidden);
    document.dispatchEvent(new windowRef.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(deleteButton);
  });

  it('guarda la canción abierta desde el botón principal sin usar campos de otra canción', async () => {
    const alpha = sharedServer.addSong('Alpha', [{ name: 'Intro Alpha', measures: 2, bpm: 80 }]);
    const beta = sharedServer.addSong('Beta', [{ name: 'Intro Beta', measures: 2, bpm: 140 }]);
    await init();
    clickSongAction('Alpha', 'open');
    await waitFor(() => document.querySelector('#metronome-song-now').textContent === 'Alpha');
    click('#metronome-configure');
    click('#metronome-cancel-blocks');
    clickSongAction('Beta', 'open');
    await waitFor(() => document.querySelector('#metronome-song-now').textContent === 'Beta');
    click('#metronome-save-song');
    await waitFor(() => document.querySelector('#metronome-status').textContent === 'Canción guardada.');
    expect(sharedServer.songs.find(song => song.id === beta.id)).toMatchObject({ name: 'Beta', blocks: [{ name: 'Intro Beta', bpm: 140 }] });
    expect(sharedServer.songs.find(song => song.id === alpha.id).blocks[0].bpm).toBe(80);
  });

  it('el BPM manual conserva las partes, la canción y sus cambios pendientes al renombrar', async () => {
    const song = sharedServer.addSong('Dos partes', [{ name: 'Intro', measures: 2, bpm: 100 }, { name: 'Coro', measures: 3, bpm: 130 }]);
    const metronome = await init();
    clickSongAction('Dos partes', 'open');
    await waitFor(() => metronome.getState().currentSongId === song.id);
    const bpmInput = document.querySelector('#metronome-bpm');
    bpmInput.value = '120';
    bpmInput.dispatchEvent(new windowRef.Event('change', { bubbles: true }));
    expect(metronome.getState()).toMatchObject({ currentSongId: song.id, songName: 'Dos partes', dirty: true });
    expect(metronome.getState().blocks).toHaveLength(2);
    expect(metronome.getState().blocks.map(block => block.bpm)).toEqual([120, 130]);
    clickSongAction('Dos partes', 'rename');
    await waitFor(() => !document.querySelector('#metronome-name-dialog').hidden);
    submitNameDialog('Nombre nuevo');
    await waitFor(() => songTitles().includes('Nombre nuevo'));
    expect(metronome.getState().dirty).toBe(true);
    expect(metronome.getState().blocks.map(block => block.bpm)).toEqual([120, 130]);
    expect(sharedServer.songs[0].blocks.map(block => block.bpm)).toEqual([100, 130]);
  });

  it('crea y renombra carpetas, crea dentro, mueve y elimina conservando contenido en la raíz', async () => {
    await init();
    click('#metronome-new-folder');
    await waitFor(() => !document.querySelector('#metronome-name-dialog').hidden);
    submitNameDialog('Banda');
    await waitFor(() => sharedServer.folders.length === 1);
    await waitFor(() => !document.querySelector('#metronome-new-folder').disabled);
    const folderId = sharedServer.folders[0].id;
    click(`[data-folder-action="rename"][data-folder-id="${folderId}"]`);
    await waitFor(() => !document.querySelector('#metronome-name-dialog').hidden);
    submitNameDialog('Banda nueva');
    await waitFor(() => sharedServer.folders[0].name === 'Banda nueva');
    await waitFor(() => !document.querySelector('#metronome-new-folder').disabled);
    click(`[data-folder-action="open"][data-folder-id="${folderId}"]`);
    expect(document.querySelector('#metronome-folder-title').textContent).toContain('Banda nueva');
    await createSavedSong('En carpeta', [{ name: 'Verso', measures: '3', bpm: '110' }]);
    expect(sharedServer.songs[0].folderId).toBe(folderId);
    const originalBlocks = structuredClone(sharedServer.songs[0].blocks);
    click('#metronome-cancel-blocks');
    const moveSelect = songActionButton('En carpeta', 'move').closest('.song-card').querySelector('[data-song-folder]');
    moveSelect.value = '';
    clickSongAction('En carpeta', 'move');
    await waitFor(() => sharedServer.songs[0].folderId === null);
    await waitFor(() => !document.querySelector('#metronome-new-folder').disabled);
    click('#metronome-folder-back');
    expect(songTitles()).toContain('En carpeta');
    const rootMoveSelect = songActionButton('En carpeta', 'move').closest('.song-card').querySelector('[data-song-folder]');
    rootMoveSelect.value = folderId;
    clickSongAction('En carpeta', 'move');
    await waitFor(() => sharedServer.songs[0].folderId === folderId);
    await waitFor(() => !document.querySelector('#metronome-new-folder').disabled);
    click(`[data-folder-action="delete"][data-folder-id="${folderId}"]`);
    await waitFor(() => !document.querySelector('#metronome-confirm-dialog').hidden);
    expect(document.querySelector('#metronome-confirm-copy').textContent).toContain('moverán');
    click('#metronome-confirm-cancel');
    expect(sharedServer.folders).toHaveLength(1);
    click(`[data-folder-action="delete"][data-folder-id="${folderId}"]`);
    await waitFor(() => !document.querySelector('#metronome-confirm-dialog').hidden);
    click('#metronome-confirm-accept');
    await waitFor(() => sharedServer.folders.length === 0);
    await waitFor(() => songTitles().includes('En carpeta'));
    expect(sharedServer.songs[0]).toMatchObject({ folderId: null, blocks: originalBlocks });
  });

  it('espera confirmación del servidor, bloquea doble guardado y conserva las claves originales', async () => {
    const original = JSON.stringify({ schemaVersion: 2, songs: [] });
    localStorage.setItem('budines.metronome.songs.v2', original);
    const metronome = await init();
    await prepareSong('Guardado lento', [{ name: 'Intro', measures: '1', bpm: '100' }]);
    const deferred = makeDeferred();
    const originalMutate = sharedServer.client.mutate.getMockImplementation();
    sharedServer.client.mutate.mockImplementationOnce(body => deferred.promise.then(() => originalMutate(body)));
    click('#metronome-save-blocks');
    click('#metronome-save-blocks');
    expect(sharedServer.client.mutate).toHaveBeenCalledTimes(1);
    expect(sharedServer.songs).toHaveLength(0);
    expect(document.querySelector('#metronome-save-blocks').disabled).toBe(true);
    expect(document.querySelector('#metronome-song-name').disabled).toBe(true);
    expect(metronome.getState().dirty).toBe(true);
    deferred.resolve();
    await waitFor(() => songTitles().includes('Guardado lento'));
    expect(sharedServer.songs).toHaveLength(1);
    expect(metronome.getState().dirty).toBe(false);
    expect(localStorage.getItem('budines.metronome.songs.v2')).toBe(original);
  });

  it('conserva la edición ante error de red y conflicto de versión sin anunciar éxito', async () => {
    const song = sharedServer.addSong('Compartida', [{ name: 'Intro', measures: 1, bpm: 100 }]);
    const metronome = await init();
    clickSongAction('Compartida', 'open');
    await waitFor(() => metronome.getState().currentSongId === song.id);
    click('#metronome-configure');
    const nameInput = document.querySelector('#metronome-song-name');
    nameInput.value = 'Edición propia';
    nameInput.dispatchEvent(new windowRef.Event('input', { bubbles: true }));
    sharedServer.client.mutate.mockRejectedValueOnce(new Error('No hay conexión. No se guardó.'));
    click('#metronome-save-blocks');
    await waitFor(() => document.querySelector('#metronome-config-error').textContent.includes('No hay conexión'));
    expect(metronome.getState()).toMatchObject({ dirty: true, songName: 'Edición propia' });
    expect(sharedServer.songs[0].name).toBe('Compartida');
    sharedServer.songs[0].name = 'Edición de otro usuario';
    sharedServer.songs[0].revision += 1;
    click('#metronome-save-blocks');
    await waitFor(() => document.querySelector('#metronome-config-error').textContent.includes('Otra persona'));
    expect(metronome.getState()).toMatchObject({ dirty: true, songName: 'Edición propia' });
    expect(nameInput.value).toBe('Edición propia');
    expect(sharedServer.songs[0].name).toBe('Edición de otro usuario');
    expect(document.querySelector('#metronome-status').textContent).not.toBe('Canción guardada.');
  });

  it('descarta una respuesta de actualización anterior a un guardado más reciente', async () => {
    sharedServer.addSong('Original', [{ name: 'Intro', measures: 1, bpm: 100 }]);
    const metronome = await init();
    clickSongAction('Original', 'open');
    await waitFor(() => metronome.getState().songName === 'Original');
    const old = await sharedServer.client.list();
    const deferred = makeDeferred();
    sharedServer.client.list.mockImplementationOnce(() => deferred.promise);
    const refresh = metronome.refresh();
    click('#metronome-configure');
    const input = document.querySelector('#metronome-song-name');
    input.value = 'Nueva';
    input.dispatchEvent(new windowRef.Event('input', { bubbles: true }));
    click('#metronome-save-blocks');
    await waitFor(() => sharedServer.songs[0].name === 'Nueva');
    deferred.resolve(old);
    await refresh;
    expect(metronome.getState().songs[0].name).toBe('Nueva');
    expect(metronome.getState().songName).toBe('Nueva');
  });

  it('el modo sin sesión permite herramientas locales y bloquea escrituras compartidas', async () => {
    await init({ authenticated: false });
    expect(document.querySelector('#metronome-save-song').disabled).toBe(true);
    expect(document.querySelector('#metronome-save-song-as').disabled).toBe(true);
    expect(document.querySelector('#metronome-new-folder').disabled).toBe(true);
    expect(document.querySelector('#metronome-start').disabled).toBe(false);
    expect(document.querySelector('#metronome-song-message').textContent).toContain('Sin sesión online');
    expect(sharedServer.client.list).not.toHaveBeenCalled();
    expect(sharedServer.client.importLegacy).not.toHaveBeenCalled();
    expect(sharedServer.client.mutate).not.toHaveBeenCalled();
  });

  it('restaura la canción compartida activa al recargar y conserva un borrador pendiente', async () => {
    const song = sharedServer.addSong('Activa', [{ name: 'Intro', measures: 2, bpm: 100 }]);
    let metronome = await init();
    clickSongAction('Activa', 'open');
    await waitFor(() => metronome.getState().currentSongId === song.id);
    setupWindow(copyLocalStorage());
    metronome = await init();
    expect(metronome.getState()).toMatchObject({ currentSongId: song.id, songName: 'Activa', dirty: false });
    expect(metronome.getState().blocks[0].bpm).toBe(100);
    click('#metronome-configure');
    const name = document.querySelector('#metronome-song-name');
    name.value = 'Borrador pendiente';
    name.dispatchEvent(new windowRef.Event('input', { bubbles: true }));
    const bpm = document.querySelector('[data-block-bpm]');
    bpm.value = '140';
    bpm.dispatchEvent(new windowRef.Event('input', { bubbles: true }));
    expect(metronome.getState().dirty).toBe(true);
    setupWindow(copyLocalStorage());
    metronome = await init();
    expect(metronome.getState()).toMatchObject({ currentSongId: song.id, songName: 'Borrador pendiente', dirty: true });
    expect(Number(metronome.getState().blocks[0].bpm)).toBe(140);
    expect(sharedServer.songs[0]).toMatchObject({ name: 'Activa', blocks: [{ bpm: 100 }] });
  });

  it('un guardado iniciado antes de cerrar sesión no repuebla el cancionero privado', async () => {
    const metronome = await init();
    await prepareSong('En vuelo', [{ name: 'Intro', measures: '1', bpm: '100' }]);
    const deferred = makeDeferred();
    const originalMutate = sharedServer.client.mutate.getMockImplementation();
    sharedServer.client.mutate.mockImplementationOnce(body => deferred.promise.then(() => originalMutate(body)));
    click('#metronome-save-blocks');
    metronome.setSession({ authenticated: false });
    deferred.resolve();
    await waitFor(() => sharedServer.songs.length === 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(metronome.getState().songs).toHaveLength(0);
    expect(document.querySelectorAll('.song-card-title')).toHaveLength(0);
    expect(document.querySelector('#metronome-save-song').disabled).toBe(true);
    expect(document.querySelector('#metronome-status').textContent).not.toBe('Canción guardada.');
  });

  it('una lista en vuelo no repuebla canciones después de cerrar sesión', async () => {
    sharedServer.addSong('Privada compartida', [{ name: 'Intro', measures: 2, bpm: 100 }]);
    const metronome = await init();
    const oldList = await sharedServer.client.list();
    const deferred = makeDeferred();
    sharedServer.client.list.mockImplementationOnce(() => deferred.promise);
    const refresh = metronome.refresh();
    metronome.setSession({ authenticated: false });
    deferred.resolve(oldList);
    await refresh;
    expect(metronome.getState().songs).toHaveLength(0);
    expect(document.querySelectorAll('.song-card-title')).toHaveLength(0);
    expect(document.querySelector('#metronome-save-song').disabled).toBe(true);
  });

  it('un alta confirmada por el servidor con respuesta perdida no se duplica al reintentar tras recarga', async () => {
    await init();
    await prepareSong('Creación incierta', [{ name: 'Intro', measures: '1', bpm: '100' }]);
    const originalMutate = sharedServer.client.mutate.getMockImplementation();
    sharedServer.client.mutate.mockImplementationOnce(async body => {
      await originalMutate(body);
      throw new Error('No se pudo confirmar la operación; reintentá.');
    });
    click('#metronome-save-blocks');
    await waitFor(() => document.querySelector('#metronome-config-error').textContent.includes('confirmar'));
    const firstId = sharedServer.songs[0].id;
    setupWindow(copyLocalStorage());
    const metronome = await init();
    click('#metronome-configure');
    click('#metronome-save-blocks');
    await waitFor(() => !metronome.getState().dirty);
    expect(sharedServer.songs).toHaveLength(1);
    expect(sharedServer.client.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ song: expect.objectContaining({ id: firstId }) }));
  });

  it('una carpeta creada con respuesta perdida conserva su ID al reintentar tras recarga', async () => {
    await init();
    const originalMutate = sharedServer.client.mutate.getMockImplementation();
    sharedServer.client.mutate.mockImplementationOnce(async body => {
      await originalMutate(body);
      throw new Error('No se pudo confirmar la operación; reintentá.');
    });
    click('#metronome-new-folder');
    await waitFor(() => !document.querySelector('#metronome-name-dialog').hidden);
    submitNameDialog('Carpeta incierta');
    await waitFor(() => document.querySelector('#metronome-song-message').textContent.includes('confirmar'));
    const firstId = sharedServer.folders[0].id;
    setupWindow(copyLocalStorage());
    await init();
    click('#metronome-new-folder');
    await waitFor(() => !document.querySelector('#metronome-name-dialog').hidden);
    submitNameDialog('Carpeta incierta');
    await waitFor(() => sharedServer.client.mutate.mock.calls.length === 2 && document.querySelector('#metronome-song-message').textContent === 'Carpeta creada.');
    expect(sharedServer.folders).toHaveLength(1);
    expect(sharedServer.client.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'createFolder', id: firstId, name: 'Carpeta incierta' }));
  });

  it.each(['rename', 'move'])('%s conserva la revisión original de un borrador que cambió en otra sesión', async action => {
    const song = sharedServer.addSong('Con conflicto', [{ name: 'Intro', measures: 1, bpm: 100 }]);
    sharedServer.folders.push({ id: 'folder-a', name: 'Banda', revision: 1, createdAt: song.createdAt, updatedAt: song.updatedAt });
    const metronome = await init();
    clickSongAction('Con conflicto', 'open');
    await waitFor(() => metronome.getState().currentSongId === song.id);
    const bpm = document.querySelector('#metronome-bpm');
    bpm.value = '120';
    bpm.dispatchEvent(new windowRef.Event('change', { bubbles: true }));
    song.blocks[0].bpm = 140;
    song.revision = 2;
    await metronome.refresh();
    if (action === 'rename') {
      clickSongAction('Con conflicto', 'rename');
      await waitFor(() => !document.querySelector('#metronome-name-dialog').hidden);
      submitNameDialog('Nombre propio');
    } else {
      const card = songActionButton('Con conflicto', 'move').closest('.song-card');
      card.querySelector('[data-song-folder]').value = 'folder-a';
      clickSongAction('Con conflicto', 'move');
    }
    await waitFor(() => document.querySelector('#metronome-status').textContent.includes('Otra persona'));
    expect(sharedServer.client.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ song: expect.objectContaining({ revision: 1 }) }));
    expect(song).toMatchObject({ name: 'Con conflicto', folderId: null, revision: 2, blocks: [{ bpm: 140 }] });
    expect(metronome.getState().dirty).toBe(true);
    expect(Number(metronome.getState().blocks[0].bpm)).toBe(120);
    click('#metronome-save-song');
    await waitFor(() => sharedServer.client.mutate.mock.calls.length === 2);
    expect(sharedServer.client.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ song: expect.objectContaining({ revision: 1 }) }));
    expect(song.blocks[0].bpm).toBe(140);
  });

  it('eliminar la carpeta de un borrador en conflicto conserva el contenido remoto y la revisión base', async () => {
    const song = sharedServer.addSong('En carpeta con conflicto', [{ name: 'Intro', measures: 1, bpm: 100 }]);
    const folder = { id: 'folder-conflict', name: 'Banda', revision: 1, createdAt: song.createdAt, updatedAt: song.updatedAt };
    sharedServer.folders.push(folder);
    song.folderId = folder.id;
    const metronome = await init();
    click(`[data-folder-action="open"][data-folder-id="${folder.id}"]`);
    clickSongAction(song.name, 'open');
    await waitFor(() => metronome.getState().currentSongId === song.id);
    const bpm = document.querySelector('#metronome-bpm');
    bpm.value = '120';
    bpm.dispatchEvent(new windowRef.Event('change', { bubbles: true }));
    song.blocks[0].bpm = 140;
    song.revision = 2;
    await metronome.refresh();
    click('#metronome-folder-back');
    click(`[data-folder-action="delete"][data-folder-id="${folder.id}"]`);
    await waitFor(() => !document.querySelector('#metronome-confirm-dialog').hidden);
    click('#metronome-confirm-accept');
    await waitFor(() => sharedServer.folders.length === 0 && !document.querySelector('#metronome-new-folder').disabled);
    expect(song).toMatchObject({ folderId: null, blocks: [{ bpm: 140 }], revision: 3 });
    expect(metronome.getState().dirty).toBe(true);
    click('#metronome-save-song');
    expect(sharedServer.client.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ song: expect.objectContaining({ revision: 1 }) }));
    await waitFor(() => document.querySelector('#metronome-config-error').textContent.includes('Otra persona'));
    expect(song.blocks[0].bpm).toBe(140);
  });
});

async function init({ authenticated = true, client = sharedServer.client } = {}) {
  vi.resetModules();
  const { initMetronome } = await import('../public/js/metronome-editor.js');
  const metronome = initMetronome(document.querySelector('#metronome-tool'), {
    register: vi.fn(),
    requestStart: vi.fn().mockResolvedValue(undefined)
  }, { authenticated, client });
  instances.push(metronome);
  if (authenticated) await waitFor(() => !document.querySelector('#metronome-new-folder').disabled);
  return metronome;
}

function setupWindow(storage = {}) {
  windowRef?.close();
  windowRef = new Window({ url: 'https://budines.test/' });
  windowRef.document.write(html);
  windowRef.document.close();
  for (const [key, value] of Object.entries(storage)) {
    windowRef.localStorage.setItem(key, value);
  }

  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.lang = '';
      this.voice = null;
      this.rate = 1;
      this.volume = 1;
      this.pitch = 1;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    }
  }

  vi.stubGlobal('window', windowRef);
  vi.stubGlobal('document', windowRef.document);
  vi.stubGlobal('HTMLElement', windowRef.HTMLElement);
  vi.stubGlobal('Event', windowRef.Event);
  vi.stubGlobal('KeyboardEvent', windowRef.KeyboardEvent);
  vi.stubGlobal('MouseEvent', windowRef.MouseEvent);
  vi.stubGlobal('localStorage', windowRef.localStorage);
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => {
      uuidIndex += 1;
      return `uuid-${uuidIndex}`;
    })
  });
  windowRef.crypto = globalThis.crypto;
  windowRef.SpeechSynthesisUtterance = FakeUtterance;
  windowRef.speechSynthesis = {
    getVoices: vi.fn(() => [{ name: 'Argentina', lang: 'es-AR', voiceURI: 'es-ar' }]),
    speak: vi.fn((utterance) => {
      utterance.onstart?.();
      setTimeout(() => utterance.onend?.(), 0);
    }),
    cancel: vi.fn(),
    addEventListener: vi.fn()
  };
  windowRef.AudioContext = FakeAudioContext;
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
  }

  createGain() {
    return {
      gain: {
        value: 1,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn()
      },
      connect: vi.fn()
    };
  }

  createOscillator() {
    return {
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn()
    };
  }

  resume() {
    return Promise.resolve();
  }
}

function click(target) {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (!element) {
    throw new Error(`Missing click target ${target}`);
  }
  element.dispatchEvent(new windowRef.MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function createSavedSong(name, parts) {
  await prepareSong(name, parts);
  click('#metronome-save-blocks');
  await waitFor(() => songTitles().includes(name));
}

async function prepareSong(name, parts) {
  click('#metronome-new-song');
  await waitFor(() => !document.querySelector('#metronome-config-dialog').hidden);
  for (const [index, part] of parts.entries()) {
    click('#metronome-add-block');
    const row = [...document.querySelectorAll('[data-metronome-block-row]')][index];
    click(row.querySelector('[data-part-name-button]'));
    const currentRow = [...document.querySelectorAll('[data-metronome-block-row]')][index];
    const nameInput = currentRow.querySelector('[data-part-name-input]');
    nameInput.value = part.name;
    nameInput.dispatchEvent(new windowRef.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const savedRow = [...document.querySelectorAll('[data-metronome-block-row]')][index];
    savedRow.querySelector('[data-block-measures]').value = part.measures;
    savedRow.querySelector('[data-block-bpm]').value = part.bpm;
    savedRow.querySelector('[data-block-bpm]').dispatchEvent(new windowRef.Event('input', { bubbles: true }));
  }
  document.querySelector('#metronome-song-name').value = name;
  document.querySelector('#metronome-song-name').dispatchEvent(new windowRef.Event('input', { bubbles: true }));
}

function clickSongAction(title, action) {
  click(songActionButton(title, action));
}

function songActionButton(title, action) {
  const card = [...document.querySelectorAll('.song-card')].find((item) => item.querySelector('.song-card-title')?.textContent === title);
  if (!card) {
    throw new Error(`Missing song card ${title}`);
  }
  return card.querySelector(`[data-song-action="${action}"]`);
}

function submitNameDialog(value) {
  const input = document.querySelector('#metronome-name-input');
  input.value = value;
  document.querySelector('#metronome-name-form').dispatchEvent(new windowRef.Event('submit', { bubbles: true, cancelable: true }));
}

function songTitles() {
  return [...document.querySelectorAll('.song-card-title')].map((item) => item.textContent);
}

function copyLocalStorage() {
  const result = {};
  for (let index = 0; index < windowRef.localStorage.length; index += 1) {
    const key = windowRef.localStorage.key(index);
    result[key] = windowRef.localStorage.getItem(key);
  }
  return result;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timeout');
}

function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createSharedServer() {
  const songs = [];
  const folders = [];
  let sequence = 0;
  const timestamp = '2026-10-12T12:00:00.000Z';
  const copy = value => structuredClone(value);
  const addSong = (name, parts) => {
    sequence += 1;
    const song = { id: `server-song-${sequence}`, schemaVersion: 2, name, folderId: null, revision: 1, createdAt: timestamp, updatedAt: timestamp,
      blocks: parts.map((block, order) => ({ id: `part-${order}`, ...block, order })) };
    songs.push(song);
    return song;
  };
  const client = {
    importLegacy: vi.fn(async () => ({ imported: 0, skipped: 0, invalid: 0, mappings: {}, mappingEntries: [] })),
    list: vi.fn(async () => ({ ok: true, songs: copy(songs), folders: copy(folders) })),
    mutate: vi.fn(async body => {
      if (body.action === 'createSong') {
        const existing = songs.find(song => song.id === body.song.id);
        if (existing) return { ok: true, song: copy(existing) };
        const song = { ...copy(body.song), schemaVersion: 2, revision: 1, createdAt: timestamp, updatedAt: timestamp };
        songs.push(song);
        return { ok: true, song: copy(song) };
      }
      if (body.action === 'updateSong') {
        const index = songs.findIndex(song => song.id === body.song.id);
        const existing = songs[index];
        if (existing.revision !== body.song.revision) throw Object.assign(new Error('Otra persona modificó esta canción. Tu edición se conserva.'), { status: 409 });
        songs[index] = { ...copy(body.song), schemaVersion: 2, revision: existing.revision + 1, createdAt: existing.createdAt, updatedAt: timestamp };
        return { ok: true, song: copy(songs[index]) };
      }
      if (body.action === 'deleteSong') {
        songs.splice(songs.findIndex(song => song.id === body.id), 1);
        return { ok: true, deleted: true, id: body.id };
      }
      if (body.action === 'createFolder') {
        const existing = folders.find(folder => folder.id === body.id);
        if (existing) return { ok: true, folder: copy(existing) };
        const folder = { id: body.id, name: body.name, revision: 1, createdAt: timestamp, updatedAt: timestamp };
        folders.push(folder);
        return { ok: true, folder: copy(folder) };
      }
      if (body.action === 'renameFolder') {
        const folder = folders.find(folder => folder.id === body.id);
        folder.name = body.name;
        folder.revision += 1;
        return { ok: true, folder: copy(folder) };
      }
      if (body.action === 'deleteFolder') {
        folders.splice(folders.findIndex(folder => folder.id === body.id), 1);
        for (const song of songs) if (song.folderId === body.id) { song.folderId = null; song.revision += 1; }
        return { ok: true, deleted: true, id: body.id };
      }
      throw new Error(`Acción de prueba inesperada: ${body.action}`);
    })
  };
  return { songs, folders, addSong, client };
}
