import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync('public/index.html', 'utf8');

let windowRef;
let uuidIndex;

beforeEach(() => {
  uuidIndex = 0;
  setupWindow();
});

afterEach(() => {
  vi.restoreAllMocks();
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

    expect(document.querySelector('#metronome-status').textContent).toBe('Canción guardada.');
    expect(document.querySelectorAll('.song-card')).toHaveLength(1);
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

    for (let index = 0; index < 32; index += 1) {
      click('#metronome-add-block');
    }

    expect(document.querySelectorAll('[data-metronome-block-row]')).toHaveLength(32);
    expect(document.querySelector('#metronome-part-count').textContent).toBe('32 de 32 partes');
    expect(document.querySelector('#metronome-add-block').disabled).toBe(true);
    expect(document.querySelector('#metronome-restart').textContent).toBe('Reiniciar');
    expect(document.querySelector('#metronome-restart').disabled).toBe(false);

    click('#metronome-test-voice');
    await waitFor(() => document.querySelector('#metronome-status').textContent.length > 0);
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
    expect(document.querySelectorAll('.song-card')).toHaveLength(1);

    document.querySelector('#metronome-song-name').value = 'Cancion Copia';
    document.querySelector('#metronome-song-name').dispatchEvent(new windowRef.Event('input', { bubbles: true }));
    click('#metronome-save-blocks-as');
    await waitFor(() => document.querySelectorAll('.song-card').length === 2);
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
});

async function init() {
  vi.resetModules();
  const { initMetronome } = await import('../public/js/metronome-editor.js');
  return initMetronome(document.querySelector('#metronome-tool'), {
    register: vi.fn(),
    requestStart: vi.fn().mockResolvedValue(undefined)
  });
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
  click('#metronome-save-blocks');
  await waitFor(() => songTitles().includes(name));
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
