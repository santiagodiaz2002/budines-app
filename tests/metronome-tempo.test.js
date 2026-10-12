import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  advancePlaybackRuntime,
  advanceRuntime,
  createPlaybackRuntime,
  createRuntime,
  createSong,
  getPlaybackBpm,
  getPlaybackInterval,
  getTempoTimeAtBeat,
  hasUnsavedBlockChanges,
  sanitizeSongLibrary,
  serializeSongDraft,
  validateEditableBlocks
} from '../public/js/metronome-core-v2.js';
import { MetronomeAudio } from '../public/js/metronome-editor.js';

const rampBlock = {
  id: 'intro', name: 'Intro', bpm: 100, measures: 3, order: 0,
  ramp: { enabled: true, targetBpm: 140, measures: 1 }
};

afterEach(() => vi.unstubAllGlobals());

describe('aceleración progresiva del cancionero', () => {
  it('compara borradores de formularios sin perder texto inválido ni reemplazar partes', () => {
    const saved = { name: 'Ensayo', blocks: [rampBlock] };
    const textual = { name: ' Ensayo ', blocks: [{ ...rampBlock, id: 'otro-id', bpm: '100', measures: '3', ramp: { enabled: true, targetBpm: '140', measures: '1' } }] };
    expect(serializeSongDraft(textual)).toBe(serializeSongDraft(saved));
    expect(serializeSongDraft({ name: 'Ensayo', blocks: [{ measures: '3', bpm: '100', ramp: { measures: '1', targetBpm: '140', enabled: true }, name: 'Intro' }] })).toBe(serializeSongDraft(saved));
    expect(hasUnsavedBlockChanges(textual.blocks, saved.blocks)).toBe(false);
    for (const value of ['', 'cien', '1e2', '301']) {
      const draft = { ...textual, blocks: [{ ...textual.blocks[0], bpm: value }] };
      const snapshot = JSON.parse(serializeSongDraft(draft));
      expect(snapshot.blocks).toHaveLength(1);
      expect(snapshot.blocks[0].bpm).toBe(value);
      expect(snapshot.blocks[0].ramp).toEqual(rampBlock.ramp);
      expect(serializeSongDraft(draft)).not.toBe(serializeSongDraft(saved));
      expect(hasUnsavedBlockChanges(draft.blocks, saved.blocks)).toBe(true);
    }
    const broken = { name: 'Ensayo', blocks: [null, { ...rampBlock, ramp: { enabled: true, targetBpm: '', measures: 'muchos' }, musicalSetting: 'preservada' }] };
    const snapshot = JSON.parse(serializeSongDraft(broken));
    expect(snapshot.blocks[0]).toBeNull();
    expect(snapshot.blocks[1].ramp.targetBpm).toBe('');
    expect(snapshot.blocks[1].ramp.measures).toBe('muchos');
    expect(snapshot.blocks[1].musicalSetting).toBe('preservada');
  });

  it('integra exactamente 100 a 140 BPM en un compás y mantiene 140 después', () => {
    let runtime = createRuntime([rampBlock]);
    const intervals = [];
    const tempos = [];
    for (let beat = 0; beat < 8; beat += 1) {
      tempos.push(getPlaybackBpm(runtime, [rampBlock]));
      intervals.push(getPlaybackInterval(runtime, [rampBlock]));
      runtime = advanceRuntime(runtime, [rampBlock]);
    }
    expect(tempos).toEqual([100, 110, 120, 130, 140, 140, 140, 140]);
    for (let index = 1; index < 4; index += 1) {
      expect(intervals[index]).toBeLessThan(intervals[index - 1]);
    }
    expect(intervals.slice(0, 4).reduce((sum, interval) => sum + interval, 0)).toBeCloseTo(6 * Math.log(1.4), 12);
    expect(intervals[0]).toBeCloseTo(0.5718610788259496, 12);
    expect(intervals[3]).toBeCloseTo(0.44464783292233045, 12);
    expect(intervals[4]).toBeCloseTo(60 / 140, 12);
    expect(runtime.bpm).toBe(140);
  });

  it('conserva el count-in de cuatro pulsos y permite varios compases o desactivar', () => {
    const block = { ...rampBlock, ramp: { ...rampBlock.ramp, measures: 2 } };
    let runtime = createPlaybackRuntime([block]);
    for (let beat = 0; beat < 4; beat += 1) {
      expect(runtime.phase).toBe('countIn');
      expect(getPlaybackInterval(runtime, [block])).toBe(0.6);
      runtime = advancePlaybackRuntime(runtime, [block]);
    }
    expect(runtime.phase).toBe('playing');
    for (let beat = 0; beat < 8; beat += 1) {
      expect(getPlaybackBpm(runtime, [block])).toBe(100 + beat * 5);
      runtime = advancePlaybackRuntime(runtime, [block]);
    }
    expect(runtime.bpm).toBe(140);
    expect(getTempoTimeAtBeat(block, 8)).toBeCloseTo(12 * Math.log(1.4), 12);
    const disabled = { ...block, ramp: { ...block.ramp, enabled: false } };
    expect(getPlaybackBpm(runtime, [disabled])).toBe(100);
    expect(getPlaybackInterval(runtime, [disabled])).toBeCloseTo(0.6, 12);
  });

  it('una sola parte de un compás conserva 140 BPM en sus siguientes vueltas', () => {
    const block = { ...rampBlock, measures: 1 };
    let runtime = createRuntime([block]);
    const tempos = [];
    const intervals = [];
    for (let beat = 0; beat < 20; beat += 1) {
      tempos.push(getPlaybackBpm(runtime, [block]));
      intervals.push(getPlaybackInterval(runtime, [block]));
      runtime = advanceRuntime(runtime, [block]);
    }
    expect(tempos.slice(0, 5)).toEqual([100, 110, 120, 130, 140]);
    expect(tempos.slice(4)).toEqual(Array(16).fill(140));
    for (const interval of intervals.slice(4)) expect(interval).toBeCloseTo(60 / 140, 12);
    expect(runtime).toMatchObject({ measureInBlock: 1, beatInMeasure: 1, bpm: 140, rampComplete: true });
    expect(createPlaybackRuntime([block]).bpm).toBe(100);
    const other = { id: 'verse', name: 'Verso', measures: 1, bpm: 90, order: 1 };
    let multiple = createRuntime([block, other]);
    for (let beat = 0; beat < 8; beat += 1) multiple = advanceRuntime(multiple, [block, other]);
    expect(multiple).toMatchObject({ blockIndex: 0, bpm: 100 });
    expect(multiple.rampComplete).toBeUndefined();
  });

  it('persiste parámetros y rechaza aceleraciones fuera de la parte o del rango', () => {
    const song = createSong({ name: 'Ensayo', blocks: [rampBlock] });
    expect(song.ok).toBe(true);
    expect(sanitizeSongLibrary({ songs: [JSON.parse(JSON.stringify(song.song))] }).songs[0].blocks[0].ramp).toEqual(rampBlock.ramp);
    expect(JSON.parse(serializeSongDraft(song.song)).blocks[0].ramp).toEqual(rampBlock.ramp);
    for (const ramp of [
      { enabled: true, targetBpm: 90, measures: 1 },
      { enabled: true, targetBpm: 301, measures: 1 },
      { enabled: true, targetBpm: 140, measures: 0 },
      { enabled: true, targetBpm: 140, measures: 4 },
      { enabled: 'true', targetBpm: 140, measures: 1 }
    ]) {
      expect(validateEditableBlocks([{ ...rampBlock, ramp }]).ok).toBe(false);
    }
    const disabled = { enabled: false, targetBpm: 90, measures: 1 };
    expect(validateEditableBlocks([{ ...rampBlock, ramp: disabled }]).blocks[0].ramp).toEqual(disabled);
  });
});

describe('scheduler Web Audio del cancionero', () => {
  it('programa los intervalos reales de la curva en AudioContext, sin pausas agregadas', async () => {
    const clock = createAudioClock();
    const onBeat = vi.fn();
    const audio = createAudio(onBeat);
    expect(await audio.start({ runtime: createPlaybackRuntime([rampBlock]), blocks: [rampBlock] })).toBe(true);
    clock.advanceTo(5.4);
    const clicks = clock.context.nodes.map((node) => node.startedAt);
    expect(clicks.slice(0, 5)).toEqual([0.05, 0.65, 1.25, 1.85, 2.45]);
    const realPulses = clicks.slice(4);
    for (let beat = 0; beat <= 4; beat += 1) {
      expect(realPulses[beat]).toBeCloseTo(2.45 + getTempoTimeAtBeat(rampBlock, beat), 12);
    }
    expect(onBeat.mock.calls.slice(0, 5).map(([runtime]) => runtime.bpm)).toEqual([100, 110, 120, 130, 140]);
    expect(realPulses[5] - realPulses[4]).toBeCloseTo(60 / 140, 12);
    audio.stop();
    expect(clock.intervals.size).toBe(0);
  });

  it('stop y reinicio cancelan clicks/callbacks anteriores y dejan un solo scheduler', async () => {
    const clock = createAudioClock();
    const onBeat = vi.fn();
    const audio = createAudio(onBeat);
    await audio.start({ runtime: createRuntime([rampBlock]), blocks: [rampBlock] });
    const oldCallback = [...clock.timeouts.values()][0].callback;
    const oldNode = clock.context.nodes[0];
    audio.stop();
    expect(oldNode.stops.at(-1)).toBe(0);
    expect(clock.timeouts.size).toBe(0);
    await audio.restart({ runtime: createRuntime([rampBlock]), blocks: [rampBlock] });
    oldCallback();
    expect(onBeat).not.toHaveBeenCalled();
    expect(clock.intervals.size).toBe(1);
    clock.advanceTo(0.1);
    expect(onBeat).toHaveBeenCalledTimes(1);
    expect(onBeat.mock.calls[0][0].bpm).toBe(100);
    audio.stop();
  });

  it('AudioContext mantiene el objetivo de una sola parte tras varios loops', async () => {
    const clock = createAudioClock();
    const onBeat = vi.fn();
    const block = { ...rampBlock, measures: 1 };
    const audio = createAudio(onBeat);
    await audio.start({ runtime: createRuntime([block]), blocks: [block] });
    clock.advanceTo(6);
    const clicks = clock.context.nodes.map((node) => node.startedAt);
    expect(clicks[4]).toBeCloseTo(0.05 + getTempoTimeAtBeat(block, 4), 12);
    for (let beat = 4; beat < clicks.length - 1; beat += 1) {
      expect(clicks[beat + 1] - clicks[beat]).toBeCloseTo(60 / 140, 12);
    }
    expect(onBeat.mock.calls.slice(4).every(([runtime]) => runtime.bpm === 140)).toBe(true);
    expect(onBeat.mock.calls.filter(([runtime]) => runtime.phase === 'countIn')).toHaveLength(0);
    audio.stop();
    await audio.restart({ runtime: createPlaybackRuntime([block]), blocks: [block] });
    expect(audio.runtime).toMatchObject({ phase: 'countIn', bpm: 100 });
    expect(audio.runtime.rampComplete).toBeUndefined();
    audio.stop();
  });

  it('pausa/reanuda desde el pulso siguiente sin repetir el último', async () => {
    const clock = createAudioClock();
    const onBeat = vi.fn();
    const audio = createAudio(onBeat);
    await audio.start({ runtime: createRuntime([rampBlock]), blocks: [rampBlock] });
    clock.advanceTo(0.2);
    audio.pause();
    expect(onBeat.mock.calls.map(([runtime]) => runtime.beatInMeasure)).toEqual([1]);
    clock.context.currentTime = 1;
    await audio.resume({ runtime: onBeat.mock.calls[0][0], blocks: [rampBlock] });
    clock.advanceTo(1.5);
    expect(onBeat.mock.calls.map(([runtime]) => runtime.beatInMeasure)).toEqual([1, 2]);
    expect(clock.intervals.size).toBe(1);
    audio.stop();
  });

  it('espera permisos de audio, coalesce inicios y descarta una resolución posterior a Stop', async () => {
    const clock = createAudioClock({ deferredResume: true });
    const audio = createAudio();
    const first = audio.start({ runtime: createRuntime([rampBlock]), blocks: [rampBlock] });
    expect(await audio.start({ runtime: createRuntime([rampBlock]), blocks: [rampBlock] })).toBe(false);
    expect(clock.intervals.size).toBe(0);
    audio.stop();
    clock.context.resumeResolvers[0]();
    expect(await first).toBe(false);
    expect(clock.intervals.size).toBe(0);

    const restart = audio.restart({ runtime: createRuntime([rampBlock]), blocks: [rampBlock] });
    clock.context.resumeResolvers[1]();
    expect(await restart).toBe(true);
    expect(clock.intervals.size).toBe(1);
    audio.stop();
  });

  it('salta pulsos vencidos al volver del fondo en vez de producir una ráfaga', async () => {
    const clock = createAudioClock();
    const onBeat = vi.fn();
    const audio = createAudio(onBeat);
    await audio.start({ runtime: createRuntime([rampBlock]), blocks: [rampBlock] });
    const lateCallback = [...clock.timeouts.values()][0].callback;
    clock.context.currentTime = 4;
    lateCallback();
    expect(onBeat).not.toHaveBeenCalled();
    const before = clock.context.nodes.length;
    audio.scheduler(audio.sequence);
    expect(clock.context.nodes.slice(before).every((node) => node.startedAt >= 4)).toBe(true);
    expect(clock.context.nodes.length - before).toBeLessThanOrEqual(1);
    audio.stop();
  });

  it('informa fallos de apertura o permisos sin anunciar un inicio ni programar audio', async () => {
    const clock = createAudioClock();
    const audio = createAudio();
    window.AudioContext = class { constructor() { throw new Error('audio device unavailable'); } };
    expect(await audio.start({ runtime: createRuntime([rampBlock]), blocks: [rampBlock] })).toBe(false);
    expect(audio.onStatus).toHaveBeenCalledWith(expect.stringContaining('No se pudo abrir el audio'));
    expect(clock.intervals.size).toBe(0);
    createAudioClock();
    const blocked = createAudio();
    const NativeFake = window.AudioContext;
    window.AudioContext = class extends NativeFake { resume() { return Promise.reject(new Error('audio denied')); } };
    expect(await blocked.start({ runtime: createRuntime([rampBlock]), blocks: [rampBlock] })).toBe(false);
    expect(blocked.onStatus).toHaveBeenCalledWith(expect.stringContaining('No se pudo iniciar el audio'));
    expect(blocked.timer).toBeNull();
  });
});

function createAudio(onBeat = vi.fn()) {
  return new MetronomeAudio({
    speech: { cancel: vi.fn(), speak: vi.fn().mockResolvedValue(true) },
    getSpeechSettings: () => ({ announceParts: false }),
    onBeat,
    onCountIn: vi.fn(),
    onStatus: vi.fn()
  });
}

function createAudioClock({ deferredResume = false } = {}) {
  const clock = { intervals: new Map(), timeouts: new Map(), context: null };
  let nextId = 1;
  class AudioContext {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
      this.nodes = [];
      this.resumeResolvers = [];
      clock.context = this;
    }
    resume() {
      return deferredResume ? new Promise((resolve) => this.resumeResolvers.push(resolve)) : Promise.resolve();
    }
    createGain() {
      return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
    createOscillator() {
      const node = { frequency: { value: 0 }, stops: [], connect() {}, addEventListener() {},
        start(time) { this.startedAt = time; }, stop(time) { this.stops.push(time); } };
      this.nodes.push(node);
      return node;
    }
  }
  vi.stubGlobal('window', {
    AudioContext,
    setInterval(callback, milliseconds) {
      const id = nextId++;
      clock.intervals.set(id, { callback, seconds: milliseconds / 1000, time: clock.context.currentTime + milliseconds / 1000 });
      return id;
    },
    clearInterval(id) { clock.intervals.delete(id); },
    setTimeout(callback, milliseconds) {
      const id = nextId++;
      clock.timeouts.set(id, { callback, time: clock.context.currentTime + milliseconds / 1000 });
      return id;
    },
    clearTimeout(id) { clock.timeouts.delete(id); }
  });
  clock.advanceTo = (target) => {
    while (true) {
      const events = [
        ...[...clock.intervals.entries()].map(([id, entry]) => ({ ...entry, id, interval: true })),
        ...[...clock.timeouts.entries()].map(([id, entry]) => ({ ...entry, id, interval: false }))
      ].filter((event) => event.time <= target).sort((left, right) => left.time - right.time);
      const event = events[0];
      if (!event) { break; }
      clock.context.currentTime = event.time;
      if (event.interval) {
        clock.intervals.get(event.id).time += event.seconds;
      } else {
        clock.timeouts.delete(event.id);
      }
      event.callback();
    }
    clock.context.currentTime = target;
  };
  return clock;
}
