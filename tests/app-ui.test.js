import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSong } from '../public/js/metronome-core-v2.js';

const html = readFileSync('public/index.html', 'utf8');
const owner = { id: 'santi', displayName: 'Santi', capabilities: { canAccessBudines: true } };
let windowRef;
let fetchCalls;
let sharedSongs;
let sharedFolders;
let importLedger;

beforeEach(() => {
  fetchCalls = [];
  sharedSongs = [];
  sharedFolders = [];
  importLedger = new Map();
  windowRef = new Window({ url: 'https://budines.test/' });
  windowRef.document.write(html);
  windowRef.document.close();
  vi.stubGlobal('window', windowRef);
  vi.stubGlobal('document', windowRef.document);
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('fetch', vi.fn(async (input, options = {}) => {
    const url = new URL(String(input), 'https://budines.test');
    fetchCalls.push(url.pathname);
    if (url.pathname === '/api/session') return json({ ok: true, authenticated: true, user: owner });
    if (url.pathname === '/api/chat') return json({ ok: true, messages: [], hasMore: false });
    if (url.pathname === '/api/songbook') {
      if (options.method !== 'POST') return json({ ok: true, songs: sharedSongs, folders: sharedFolders });
      const { action, song } = JSON.parse(options.body);
      if (action === 'importSong') {
        const fingerprint = JSON.stringify({ id: song.id, createdAt: song.createdAt, name: song.name, blocks: song.blocks });
        const existing = importLedger.get(fingerprint);
        if (existing) return json({ ok: true, song: existing, importedId: existing.id, imported: false, skipped: true, deleted: false });
        const imported = { ...song, id: `shared-${importLedger.size + 1}`, folderId: null, revision: 1 };
        sharedSongs.push(imported);
        importLedger.set(fingerprint, imported);
        return json({ ok: true, song: imported, importedId: imported.id, imported: true, skipped: false, deleted: false });
      }
      throw new Error('Acción inesperada: ' + action);
    }
    throw new Error('Ruta inesperada: ' + url.pathname);
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  windowRef?.close();
});

describe('app sin contabilidad', () => {
  it('salir del afinador cancela el permiso pendiente y libera la captura tardía', async () => {
    let resolveStream;
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn(() => new Promise(resolve => { resolveStream = resolve; }));
    vi.stubGlobal('navigator', { onLine: true, mediaDevices: { getUserMedia } });
    Object.defineProperty(windowRef, 'isSecureContext', { value: true, configurable: true });
    windowRef.AudioContext = class extends windowRef.EventTarget {
      state = 'running';
      resume() { return Promise.resolve(); }
      close() { this.state = 'closed'; return Promise.resolve(); }
    };
    await importApp();
    document.querySelector('#tab-tuner').click();
    document.querySelector('#tuner-start').click();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    document.querySelector('#tab-truco').click();
    expect(document.querySelector('#tuner-tool').dataset.tunerState).toBe('stopped');
    resolveStream({ getTracks: () => [track], getAudioTracks: () => [track] });
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalledTimes(1));
    expect(document.querySelector('#tuner-tool').dataset.tunerState).toBe('stopped');
  });

  it('un owner abre Chat y no solicita ninguna API comercial', async () => {
    await importApp();
    expect(document.querySelector('#chat-tool').hidden).toBe(false);
    expect([...document.querySelectorAll('[data-tool-tab]')].map(tab => tab.dataset.toolTab)).toEqual([
      'chat', 'truco', 'metronome', 'tuner'
    ]);
    for (const id of ['budines-tool', 'tab-budines', 'sale-form', 'withdrawal-form', 'records-list', 'void-dialog', 'owner-summary-dialog']) {
      expect(document.getElementById(id)).toBeNull();
    }
    expect(fetchCalls).toContain('/api/session');
    expect(fetchCalls).toContain('/api/chat');
    expect(fetchCalls.every(path => ['/api/session', '/api/chat', '/api/songbook'].includes(path))).toBe(true);
  });

  it('conserva puntajes, visual de Truco y canciones guardadas al abrir y navegar', async () => {
    const trucoKey = 'budines.truco.v1.user.santi';
    const visualKey = 'budines.truco.visual.v1.user.santi';
    const songsKey = 'budines.metronome.songs.v2.user.santi';
    const savedTruco = JSON.stringify({ scores: { nosotros: 7, ellos: 3 }, history: [] });
    const created = createSong({
      name: 'Canción guardada',
      blocks: [{ id: 'intro', name: 'Intro', measures: 4, bpm: 110, order: 0 }],
      now: '2026-10-01T12:00:00.000Z',
      idFactory: () => 'saved-song'
    });
    expect(created.ok).toBe(true);
    const savedSongs = JSON.stringify({ schemaVersion: 2, songs: [created.song] });
    windowRef.localStorage.setItem(trucoKey, savedTruco);
    windowRef.localStorage.setItem(visualKey, 'joint');
    windowRef.localStorage.setItem(songsKey, savedSongs);

    await importApp();
    document.querySelector('#tab-truco').click();
    expect(document.querySelector('[data-truco-team="nosotros"] [data-truco-score]').textContent).toBe('7');
    expect(document.querySelector('#truco-tool').dataset.trucoVisualModel).toBe('joint');
    document.querySelector('#tab-metronome').click();
    await vi.waitFor(() => expect(document.querySelector('#metronome-song-list').textContent).toContain('Canción guardada'));
    expect(document.querySelector('#metronome-song-list').textContent).toContain('Canción guardada');
    document.querySelector('#tab-tuner').click();
    expect(document.querySelector('#tuner-tool').hidden).toBe(false);
    expect(document.querySelector('#tuner-start').disabled).toBe(false);
    expect(windowRef.localStorage.getItem(trucoKey)).toBe(savedTruco);
    expect(windowRef.localStorage.getItem(visualKey)).toBe('joint');
    expect(windowRef.localStorage.getItem(songsKey)).toBe(savedSongs);
    expect(sharedSongs).toHaveLength(1);
    expect(sharedSongs[0]).toMatchObject({ name: 'Canción guardada', blocks: created.song.blocks });

    document.querySelector('#tab-truco').click();
    document.querySelector('[data-truco-team-target="nosotros"][data-truco-action="add"]').click();
    expect(JSON.parse(windowRef.localStorage.getItem(trucoKey)).scores.nosotros).toBe(8);
    expect(windowRef.localStorage.getItem(songsKey)).toBe(savedSongs);
  });

  it('importa bibliotecas de ambos usuarios sin mezclar herramientas ni borrar originales', async () => {
    const makeSong = (id, name, bpm) => ({ id, name, schemaVersion: 2, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z',
      blocks: [{ id: 'intro', name: 'Intro', measures: 4, bpm, order: 0 }] });
    const originals = {
      'budines.metronome.songs.v2.user.santi': JSON.stringify({ schemaVersion: 2, songs: [makeSong('santi-song', 'De Santi', 100)] }),
      'budines.metronome.songs.v2.user.leandro': JSON.stringify({ schemaVersion: 2, songs: [makeSong('leandro-song', 'De Leandro', 120)] }),
      'budines.truco.v1.user.leandro': '{"scores":{"nosotros":8,"ellos":2},"history":[]}'
    };
    for (const [key, value] of Object.entries(originals)) windowRef.localStorage.setItem(key, value);
    await importApp();
    await vi.waitFor(() => expect(sharedSongs).toHaveLength(2));
    await vi.waitFor(() => expect(document.querySelectorAll('.song-card-title')).toHaveLength(2));
    expect([...document.querySelectorAll('.song-card-title')].map(node => node.textContent).sort()).toEqual(['De Leandro', 'De Santi']);
    for (const [key, value] of Object.entries(originals)) expect(windowRef.localStorage.getItem(key)).toBe(value);
    document.querySelector('#metronome-refresh').click();
    await vi.waitFor(() => expect(document.querySelector('#metronome-song-message').textContent).toBe('Cancionero compartido actualizado.'));
    expect(sharedSongs).toHaveLength(2);
  });

  it('offline conserva herramientas locales y no muestra ni guarda la canción compartida de otra sesión', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    windowRef.localStorage.setItem('budines.local.profile.v1', JSON.stringify({ id: 'santi', displayName: 'Santi' }));
    windowRef.localStorage.setItem('budines.metronome.v1.user.santi', JSON.stringify({
      currentSongId: 'shared-private', songName: 'Compartida privada', sharedSong: true,
      blocks: [{ id: 'intro', name: 'Parte privada', measures: 4, bpm: 140, order: 0 }]
    }));
    await importApp();
    document.querySelector('#tab-metronome').click();
    expect(document.querySelector('#metronome-save-song').disabled).toBe(true);
    expect(document.querySelector('#metronome-new-folder').disabled).toBe(true);
    expect(document.querySelector('#metronome-song-now').textContent).not.toContain('Compartida privada');
    expect(document.querySelector('#metronome-part-now').textContent).not.toContain('Parte privada');
    expect(fetchCalls).not.toContain('/api/songbook');
    expect(document.querySelector('#metronome-start').disabled).toBe(false);
  });

  it.each(['truco-reset-dialog', 'metronome-config-dialog', 'metronome-name-dialog', 'metronome-confirm-dialog'])(
    'mantiene el foco de teclado dentro de %s', async dialogId => {
      await importApp();
      const dialog = document.getElementById(dialogId);
      dialog.hidden = false;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
      for (const element of focusable) {
        vi.spyOn(element, 'getClientRects').mockReturnValue([{}]);
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      const tab = shiftKey => document.dispatchEvent(new windowRef.KeyboardEvent('keydown', {
        key: 'Tab', shiftKey, bubbles: true, cancelable: true
      }));

      last.focus();
      tab(false);
      expect(document.activeElement).toBe(first);
      tab(true);
      expect(document.activeElement).toBe(last);
      document.querySelector('#logout-button').focus();
      tab(false);
      expect(document.activeElement).toBe(first);
    }
  );
});

async function importApp() {
  vi.resetModules();
  await import('../public/js/app.js');
  await vi.waitFor(() => expect(document.body.dataset.authState).toBe('app'));
}

function json(payload) {
  return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
}
