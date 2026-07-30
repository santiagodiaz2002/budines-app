import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTuner } from '../public/js/tuner.js';

const html = readFileSync('public/index.html', 'utf8');

let windowRef;

beforeEach(() => {
  windowRef = new Window({
    url: 'https://budines.test/'
  });
  windowRef.document.write(html);
  windowRef.document.close();
  Object.defineProperty(windowRef, 'isSecureContext', {
    configurable: true,
    value: true
  });

  vi.stubGlobal('window', windowRef);
  vi.stubGlobal('document', windowRef.document);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  windowRef?.close();
});

describe('interfaz del afinador', () => {
  it('detener durante un permiso pendiente invalida el arranque y libera el stream tardío', async () => {
    let resolveStream;
    const track = {
      stop: vi.fn()
    };
    const getUserMedia = vi.fn(() => new Promise((resolve) => {
      resolveStream = resolve;
    }));
    const AudioContext = vi.fn();

    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia
      }
    });
    windowRef.AudioContext = AudioContext;

    const root = document.querySelector('#tuner-tool');
    const startButton = root.querySelector('#tuner-start');
    const stopButton = root.querySelector('#tuner-stop');
    const tuner = initTuner(root);

    startButton.click();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(root.dataset.tunerState).toBe('requesting');
    expect(startButton.disabled).toBe(true);
    expect(root.querySelector('#tuner-status').textContent).toBe('Esperando permiso de micrófono.');

    tuner.stop();
    expect(root.dataset.tunerState).toBe('stopped');
    expect(startButton.disabled).toBe(false);
    expect(stopButton.disabled).toBe(true);

    resolveStream({
      getTracks: () => [track]
    });

    await vi.waitFor(() => expect(track.stop).toHaveBeenCalledTimes(1));
    expect(AudioContext).not.toHaveBeenCalled();
    expect(root.dataset.tunerState).toBe('stopped');
    expect(root.querySelector('#tuner-status').textContent).toBe('Micrófono detenido.');
  });
});
