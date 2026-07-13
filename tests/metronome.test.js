import { describe, expect, it } from 'vitest';
import {
  advanceRuntime,
  createMetronomeMachine,
  createRuntime,
  normalizeBlocks,
  parseBpm,
  parseMeasures
} from '../public/js/metronome-core.js';

describe('metrónomo 4/4', () => {
  it('valida BPM con enteros estrictos entre 30 y 300', () => {
    for (const invalid of ['', '0', '-1', '120.5', '1e2', 'texto', '301']) {
      expect(parseBpm(invalid).ok).toBe(false);
    }

    expect(parseBpm('30')).toEqual({ ok: true, value: 30 });
    expect(parseBpm('300')).toEqual({ ok: true, value: 300 });
  });

  it('valida compases con enteros estrictos entre 1 y 999', () => {
    for (const invalid of ['', '0', '-4', '4.5', '1e2', 'mil', '1000']) {
      expect(parseMeasures(invalid).ok).toBe(false);
    }

    expect(parseMeasures('1')).toEqual({ ok: true, value: 1 });
    expect(parseMeasures('999')).toEqual({ ok: true, value: 999 });
  });

  it('avanza pulso, compás, bloque, BPM y vuelve del último bloque al primero', () => {
    const blocks = normalizeBlocks([
      { measures: 1, bpm: 100 },
      { measures: 1, bpm: 140 }
    ]);
    let runtime = createRuntime(blocks);

    expect(runtime).toMatchObject({ blockIndex: 0, measureInBlock: 1, beatInMeasure: 1, bpm: 100 });

    runtime = advanceRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ blockIndex: 0, beatInMeasure: 2, bpm: 100 });
    runtime = advanceRuntime(runtime, blocks);
    runtime = advanceRuntime(runtime, blocks);
    runtime = advanceRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ blockIndex: 1, measureInBlock: 1, beatInMeasure: 1, bpm: 140 });

    runtime = advanceRuntime(runtime, blocks);
    runtime = advanceRuntime(runtime, blocks);
    runtime = advanceRuntime(runtime, blocks);
    runtime = advanceRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ blockIndex: 0, measureInBlock: 1, beatInMeasure: 1, bpm: 100 });
  });

  it('pausa, reanuda y stop conserva/restablece estado esperado', () => {
    const machine = createMetronomeMachine([{ measures: 2, bpm: 120 }]);

    expect(machine.start()).toBe(true);
    expect(machine.start()).toBe(false);
    expect(machine.snapshot().schedulerActive).toBe(true);

    machine.tick();
    expect(machine.snapshot().runtime.beatInMeasure).toBe(2);

    expect(machine.pause()).toBe(true);
    expect(machine.snapshot()).toMatchObject({ running: true, paused: true, schedulerActive: false });

    expect(machine.resume()).toBe(true);
    expect(machine.snapshot()).toMatchObject({ running: true, paused: false, schedulerActive: true });

    machine.stop();
    expect(machine.snapshot()).toMatchObject({
      running: false,
      paused: false,
      schedulerActive: false,
      runtime: { blockIndex: 0, measureInBlock: 1, beatInMeasure: 1, bpm: 120 }
    });
  });
});
