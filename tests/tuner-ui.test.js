import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioCoordinator } from '../public/js/audio-coordinator.js';
import { initTuner } from '../public/js/tuner.js';

const html = readFileSync('public/index.html', 'utf8');
let windowRef;
let tuners;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  tuners = [];
  windowRef = new Window({ url: 'https://budines.test/' });
  windowRef.document.write(html);
  windowRef.document.close();
  Object.defineProperty(windowRef, 'isSecureContext', { configurable: true, value: true });
  vi.stubGlobal('window', windowRef);
  vi.stubGlobal('document', windowRef.document);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 99));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  for (const tuner of tuners) tuner.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  windowRef?.close();
});

function installAudio({ deferred = false, sampleRate = 48000, resumeError, resumePending = false, closeError, getUserMediaError } = {}) {
  const contexts = [];
  const captures = [];
  let resolveCapture;
  let rejectCapture;
  let rejectResume;
  let frequency = 0;
  let amplitude = 0.4;
  const createStream = () => {
    const track = new windowRef.EventTarget();
    track.readyState = 'live';
    track.stop = vi.fn(() => { track.readyState = 'ended'; });
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    captures.push({ stream, track });
    return stream;
  };
  const getUserMedia = vi.fn(() => getUserMediaError ? Promise.reject(getUserMediaError) : deferred
    ? new Promise((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject; })
    : Promise.resolve(createStream()));

  class FakeAudioContext extends windowRef.EventTarget {
    constructor(options) {
      super();
      this.options = options;
      this.state = 'suspended';
      this.sampleRate = sampleRate;
      this.source = { connect: vi.fn(), disconnect: vi.fn() };
      this.analyser = {
        fftSize: 2048,
        disconnect: vi.fn(),
        getFloatTimeDomainData: vi.fn((buffer) => {
          for (let index = 0; index < buffer.length; index += 1) {
            buffer[index] = frequency ? amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate) : 0;
          }
        })
      };
      this.resume = vi.fn(() => {
        if (resumeError) return Promise.reject(resumeError);
        if (resumePending) return new Promise((resolve, reject) => { rejectResume = reject; });
        this.state = 'running';
        this.dispatchEvent(new windowRef.Event('statechange'));
        return Promise.resolve();
      });
      this.close = vi.fn(() => {
        this.state = 'closed';
        this.dispatchEvent(new windowRef.Event('statechange'));
        return closeError ? Promise.reject(closeError) : Promise.resolve();
      });
      this.createAnalyser = vi.fn(() => this.analyser);
      this.createMediaStreamSource = vi.fn(() => this.source);
      contexts.push(this);
    }
  }

  const AudioContext = vi.fn(function AudioContext(options) { return new FakeAudioContext(options); });
  windowRef.AudioContext = AudioContext;
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  return {
    contexts,
    captures,
    AudioContext,
    getUserMedia,
    setTone(value, level = 0.4) { frequency = value; amplitude = level; },
    resolveCapture() { resolveCapture(createStream()); },
    rejectCapture(error) { rejectCapture(error); },
    rejectResume(error) { rejectResume(error); }
  };
}

function setup(coordinator) {
  const root = document.querySelector('#tuner-tool');
  const tuner = initTuner(root, coordinator);
  tuners.push(tuner);
  return {
    root,
    tuner,
    start: root.querySelector('#tuner-start'),
    stop: root.querySelector('#tuner-stop'),
    text(selector) { return root.querySelector(selector).textContent; }
  };
}

async function flush() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

describe('diagnóstico y ciclo de vida del afinador', () => {
  it('crea y reanuda Web Audio durante el gesto, antes del permiso', async () => {
    const audio = installAudio({ deferred: true });
    const ui = setup();
    ui.start.click();
    expect(audio.AudioContext).toHaveBeenCalledTimes(1);
    expect(audio.contexts[0].resume).toHaveBeenCalledTimes(1);
    await flush();
    expect(audio.getUserMedia).toHaveBeenCalledTimes(1);
    expect(ui.root.dataset.tunerState).toBe('requesting');
    expect(ui.start.disabled).toBe(true);
    expect(ui.stop.disabled).toBe(false);
    audio.resolveCapture();
    await flush();
  });

  it('permite cancelar desde el botón y detiene el stream tardío sin duplicar permisos', async () => {
    const audio = installAudio({ deferred: true });
    const ui = setup();
    ui.start.click();
    await flush();
    ui.stop.click();
    expect(ui.root.dataset.tunerState).toBe('stopped');
    expect(audio.contexts[0].close).toHaveBeenCalledTimes(1);
    expect(ui.start.disabled).toBe(true);
    expect(ui.stop.disabled).toBe(true);
    expect(ui.text('#tuner-guidance')).toContain('permiso');
    ui.start.click();
    expect(audio.getUserMedia).toHaveBeenCalledTimes(1);
    audio.resolveCapture();
    await flush();
    expect(audio.captures[0].track.stop).toHaveBeenCalledTimes(1);
    expect(audio.contexts[0].createAnalyser).not.toHaveBeenCalled();
    expect(ui.start.disabled).toBe(false);
    expect(ui.root.dataset.tunerState).toBe('stopped');
  });

  it('nunca muestra A4 ni una frecuencia objetivo cuando no existe medición', async () => {
    installAudio();
    const ui = setup();
    expect(ui.text('#tuner-note')).toBe('—');
    expect(ui.text('#tuner-octave')).toBe('');
    expect(ui.text('#tuner-target')).toBe('— Hz');
    ui.start.click();
    await flush();
    expect(ui.text('#tuner-note')).toBe('—');
    expect(ui.text('#tuner-cents')).toBe('— cents');
  });

  it('libera captura al ocultarse o salir de la página y requiere reinicio explícito', async () => {
    const audio = installAudio();
    const ui = setup();
    ui.start.click();
    await flush();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new windowRef.Event('visibilitychange'));
    expect(audio.captures[0].track.stop).toHaveBeenCalledTimes(1);
    expect(ui.root.dataset.tunerState).toBe('interrupted');
    expect(ui.text('#tuner-status')).toContain('Volvé a iniciar');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new windowRef.Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120);
    expect(audio.getUserMedia).toHaveBeenCalledTimes(1);
    ui.start.click();
    await flush();
    windowRef.dispatchEvent(new windowRef.Event('pagehide'));
    expect(audio.captures[1].track.stop).toHaveBeenCalledTimes(1);
    expect(audio.contexts[1].close).toHaveBeenCalledTimes(1);
  });

  it('cancela también un permiso pendiente cuando se oculta la página', async () => {
    const audio = installAudio({ deferred: true });
    const ui = setup();
    ui.start.click();
    await flush();
    windowRef.dispatchEvent(new windowRef.Event('pagehide'));
    expect(audio.contexts[0].close).toHaveBeenCalledTimes(1);
    expect(ui.root.dataset.tunerState).toBe('interrupted');
    audio.resolveCapture();
    await flush();
    expect(audio.captures[0].track.stop).toHaveBeenCalledTimes(1);
    expect(audio.contexts[0].createAnalyser).not.toHaveBeenCalled();
    expect(ui.start.disabled).toBe(false);
  });

  it('no crea capturas ni ciclos duplicados y reinicia con recursos nuevos', async () => {
    const audio = installAudio();
    const ui = setup();
    ui.start.click();
    ui.start.dispatchEvent(new windowRef.Event('click'));
    await flush();
    expect(audio.AudioContext).toHaveBeenCalledTimes(1);
    expect(audio.getUserMedia).toHaveBeenCalledTimes(1);
    expect(audio.contexts[0].source.connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(audio.contexts[0].analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(6);
    ui.stop.click();
    expect(audio.captures[0].track.stop).toHaveBeenCalledTimes(1);
    expect(audio.contexts[0].source.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.contexts[0].analyser.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.contexts[0].close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(audio.contexts[0].analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(6);
    ui.start.click();
    await flush();
    expect(audio.AudioContext).toHaveBeenCalledTimes(2);
    expect(audio.getUserMedia).toHaveBeenCalledTimes(2);
    expect(audio.captures[1].track.readyState).toBe('live');
    ui.stop.click();
    expect(audio.captures[1].track.stop).toHaveBeenCalledTimes(1);
  });

  it.each(['ended', 'mute'])('libera micrófono al recibir track %s', async (event) => {
    const audio = installAudio();
    const ui = setup();
    ui.start.click();
    await flush();
    audio.captures[0].track.dispatchEvent(new windowRef.Event(event));
    expect(ui.root.dataset.tunerState).toBe('interrupted');
    expect(ui.text('#tuner-status')).toContain('micrófono');
    expect(audio.captures[0].track.stop).toHaveBeenCalledTimes(1);
    expect(audio.contexts[0].close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(audio.contexts[0].analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(1);
    expect(ui.start.disabled).toBe(false);
  });

  it.each(['suspended', 'interrupted', 'closed'])('libera el micrófono si Web Audio pasa a %s', async (state) => {
    const audio = installAudio();
    const ui = setup();
    ui.start.click();
    await flush();
    audio.contexts[0].state = state;
    audio.contexts[0].dispatchEvent(new windowRef.Event('statechange'));
    expect(ui.root.dataset.tunerState).toBe('interrupted');
    expect(ui.text('#tuner-status')).toContain('Volvé a iniciar');
    expect(audio.captures[0].track.stop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(audio.contexts[0].analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['NotAllowedError', 'Permiso de micrófono denegado'],
    ['NotFoundError', 'No se encontró un micrófono'],
    ['NotReadableError', 'en uso'],
    ['OverconstrainedError', 'no admite'],
    ['AbortError', 'interrumpió']
  ])('explica %s, cierra el contexto y permite reintentar', async (name, message) => {
    const audio = installAudio({ getUserMediaError: { name } });
    const ui = setup();
    ui.start.click();
    await flush();
    expect(ui.root.dataset.tunerState).toBe('error');
    expect(ui.text('#tuner-status')).toContain(message);
    expect(ui.start.disabled).toBe(false);
    expect(ui.stop.disabled).toBe(true);
    expect(audio.contexts[0].close).toHaveBeenCalledTimes(1);
    audio.getUserMedia.mockResolvedValueOnce({ getTracks: () => [] });
    ui.start.click();
    await flush();
    expect(ui.root.dataset.tunerState).toBe('listening');
  });

  it('recupera una cancelación cuyo permiso termina denegado', async () => {
    const audio = installAudio({ deferred: true });
    const ui = setup();
    ui.start.click();
    await flush();
    ui.stop.click();
    audio.rejectCapture({ name: 'NotAllowedError' });
    await flush();
    expect(ui.root.dataset.tunerState).toBe('stopped');
    expect(ui.text('#tuner-status')).toBe('Micrófono detenido.');
    expect(ui.start.disabled).toBe(false);
  });

  it('no abre el micrófono si resume falla y maneja rechazo de close sin promesas pendientes', async () => {
    const audio = installAudio({ resumeError: new Error('resume failed'), closeError: new Error('already closed') });
    const ui = setup();
    ui.start.click();
    await flush();
    expect(ui.root.dataset.tunerState).toBe('error');
    expect(audio.getUserMedia).not.toHaveBeenCalled();
    expect(audio.contexts[0].close).toHaveBeenCalledTimes(1);
    expect(ui.start.disabled).toBe(false);
  });

  it('cierra Web Audio de inmediato si resume falla mientras el permiso está pendiente', async () => {
    const audio = installAudio({ deferred: true, resumePending: true });
    const ui = setup();
    ui.start.click();
    await flush();
    expect(audio.getUserMedia).toHaveBeenCalledTimes(1);
    audio.rejectResume(new Error('interrupted before permission'));
    await flush();
    expect(ui.root.dataset.tunerState).toBe('error');
    expect(ui.text('#tuner-status')).toContain('reanudar el audio');
    expect(audio.contexts[0].close).toHaveBeenCalledTimes(1);
    expect(ui.start.disabled).toBe(true);
    audio.resolveCapture();
    await flush();
    expect(audio.captures[0].track.stop).toHaveBeenCalledTimes(1);
    expect(audio.contexts[0].createAnalyser).not.toHaveBeenCalled();
    expect(ui.start.disabled).toBe(false);
  });

  it('limpia recursos cuando falla la construcción del grafo o la lectura', async () => {
    const audio = installAudio();
    const ui = setup();
    ui.start.click();
    audio.contexts[0].createAnalyser.mockImplementation(() => { throw new Error('graph failed'); });
    await flush();
    expect(ui.root.dataset.tunerState).toBe('error');
    expect(audio.captures[0].track.stop).toHaveBeenCalledTimes(1);
    ui.start.click();
    await flush();
    audio.contexts[1].analyser.getFloatTimeDomainData.mockImplementation(() => { throw new Error('device disconnected'); });
    await vi.advanceTimersByTimeAsync(40);
    expect(ui.root.dataset.tunerState).toBe('error');
    expect(audio.captures[1].track.stop).toHaveBeenCalledTimes(1);
    expect(audio.contexts[1].source.disconnect).toHaveBeenCalledTimes(1);
    expect(ui.start.disabled).toBe(false);
  });

  it('permite reiniciar después de fallar el constructor de Web Audio', async () => {
    const audio = installAudio();
    const ui = setup();
    audio.AudioContext.mockImplementationOnce(() => { throw new Error('no hardware'); });
    ui.start.click();
    await flush();
    expect(ui.root.dataset.tunerState).toBe('error');
    expect(audio.getUserMedia).not.toHaveBeenCalled();
    expect(ui.start.disabled).toBe(false);
    ui.start.click();
    await flush();
    expect(ui.root.dataset.tunerState).toBe('listening');
  });

  it('conserva el fallback webkitAudioContext para Safari', async () => {
    const audio = installAudio();
    windowRef.webkitAudioContext = windowRef.AudioContext;
    windowRef.AudioContext = undefined;
    const ui = setup();
    ui.start.click();
    await flush();
    expect(audio.contexts[0].resume).toHaveBeenCalledTimes(1);
    expect(ui.root.dataset.tunerState).toBe('listening');
  });

  it.each([44100, 48000, 96000])('usa una ventana suficiente a %i Hz sin superar 25 análisis/s', async (sampleRate) => {
    const audio = installAudio({ sampleRate });
    const ui = setup();
    ui.start.click();
    await flush();
    const analyser = audio.contexts[0].analyser;
    expect(analyser.fftSize).toBe(sampleRate === 96000 ? 8192 : 4096);
    expect(analyser.fftSize / sampleRate).toBeGreaterThanOrEqual(0.085);
    await vi.advanceTimersByTimeAsync(1000);
    expect(analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(26);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('mantiene la exclusión con el metrónomo incluso durante permisos pendientes', async () => {
    const audio = installAudio({ deferred: true });
    const coordinator = createAudioCoordinator();
    const stopMetronome = vi.fn();
    coordinator.register('metronome', stopMetronome);
    const ui = setup(coordinator);
    ui.start.click();
    await flush();
    expect(stopMetronome).toHaveBeenCalledTimes(1);
    await coordinator.requestStart('metronome');
    expect(ui.root.dataset.tunerState).toBe('stopped');
    audio.resolveCapture();
    await flush();
    expect(audio.captures[0].track.stop).toHaveBeenCalledTimes(1);
    ui.start.click();
    await flush();
    audio.resolveCapture();
    await flush();
    await coordinator.requestStart('metronome');
    expect(audio.captures[1].track.stop).toHaveBeenCalledTimes(1);
    expect(audio.contexts[1].close).toHaveBeenCalledTimes(1);
  });

  it('informa contextos incompatibles sin solicitar micrófono', async () => {
    const audio = installAudio();
    const ui = setup();
    Object.defineProperty(windowRef, 'isSecureContext', { configurable: true, value: false });
    ui.start.click();
    expect(ui.text('#tuner-status')).toContain('HTTPS');
    Object.defineProperty(windowRef, 'isSecureContext', { configurable: true, value: true });
    windowRef.AudioContext = undefined;
    ui.start.click();
    expect(ui.text('#tuner-status')).toContain('Web Audio');
    expect(audio.getUserMedia).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', {});
    ui.start.click();
    expect(ui.text('#tuner-status')).toContain('acceder al micrófono');
  });
});

describe('medición integrada y presentación del afinador', () => {
  it.each([
    ['E', 2, 82.406889], ['A', 2, 110], ['D', 3, 146.832384],
    ['G', 3, 195.997718], ['B', 3, 246.941651], ['E', 4, 329.627557], ['A', 4, 440]
  ])('muestra %s%i con frecuencia y cents correctos en 80 ms de confirmación', async (note, octave, frequency) => {
    const audio = installAudio();
    audio.setTone(frequency);
    const ui = setup();
    ui.start.click();
    await flush();
    expect(ui.text('#tuner-note')).toBe('—');
    await vi.advanceTimersByTimeAsync(80);
    expect(ui.text('#tuner-note')).toBe(note);
    expect(ui.text('#tuner-octave')).toBe(String(octave));
    expect(Math.abs(1200 * Math.log2(parseFloat(ui.text('#tuner-frequency')) / frequency))).toBeLessThan(2);
    expect(Math.abs(parseFloat(ui.text('#tuner-cents')))).toBeLessThan(2);
    expect(ui.text('#tuner-verdict')).toBe('Afinado');
  });

  it.each([-20, 0, 20])('muestra A4 y %i cents con dirección y objetivo correctos', async (cents) => {
    const audio = installAudio();
    audio.setTone(440 * 2 ** (cents / 1200));
    const ui = setup();
    ui.start.click();
    await flush();
    await vi.advanceTimersByTimeAsync(80);
    expect(ui.text('#tuner-note')).toBe('A');
    expect(ui.text('#tuner-octave')).toBe('4');
    expect(ui.text('#tuner-target')).toBe('440.0 Hz');
    expect(Math.abs(parseFloat(ui.text('#tuner-cents')) - cents)).toBeLessThan(2);
    if (cents === 0) expect(ui.text('#tuner-cents')).toBe('0.0 cents');
    expect(ui.text('#tuner-verdict')).toBe(cents < 0 ? 'Grave' : cents > 0 ? 'Agudo' : 'Afinado');
    expect(ui.root.dataset.tunerDirection).toBe(cents < 0 ? 'low' : cents > 0 ? 'high' : 'center');
  });

  it('retira una medición al perder señal, acepta octavas reales y resetea tras Stop', async () => {
    const audio = installAudio();
    audio.setTone(82.4069);
    const ui = setup();
    ui.start.click();
    await flush();
    await vi.advanceTimersByTimeAsync(80);
    expect(ui.text('#tuner-note')).toBe('E');
    expect(ui.text('#tuner-octave')).toBe('2');
    audio.setTone(164.8138);
    await vi.advanceTimersByTimeAsync(120);
    expect(ui.text('#tuner-octave')).toBe('3');
    audio.setTone(0);
    await vi.advanceTimersByTimeAsync(40);
    expect(ui.text('#tuner-note')).toBe('—');
    expect(ui.text('#tuner-frequency')).toBe('— Hz');
    expect(ui.root.dataset.tunerDirection).toBe('neutral');
    audio.setTone(440);
    await vi.advanceTimersByTimeAsync(120);
    expect(ui.text('#tuner-octave')).toBe('4');
    ui.stop.click();
    ui.start.click();
    await flush();
    expect(ui.text('#tuner-note')).toBe('—');
    await vi.advanceTimersByTimeAsync(80);
    expect(ui.text('#tuner-note')).toBe('A');
  });

  it('borra una medición si la señal pasa por debajo del umbral audible', async () => {
    const audio = installAudio();
    audio.setTone(440);
    const ui = setup();
    ui.start.click();
    await flush();
    await vi.advanceTimersByTimeAsync(80);
    expect(ui.text('#tuner-note')).toBe('A');
    audio.setTone(440, 0.0001);
    await vi.advanceTimersByTimeAsync(40);
    expect(ui.text('#tuner-note')).toBe('—');
    expect(ui.text('#tuner-cents')).toBe('— cents');
    expect(ui.text('#tuner-status')).toBe('Señal insuficiente.');
  });
});
