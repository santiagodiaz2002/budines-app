import { describe, expect, it, vi } from 'vitest';
import {
  classifyCents,
  createPitchStabilizer,
  detectPitchYin,
  frequencyToNote,
  stopMediaStream
} from '../public/js/tuner-core.js';
import { pitchErrorCents, TUNER_REFERENCES, TUNER_TIMBRES, tunerSignal } from './fixtures/tuner-signals.js';

const SAMPLE_RATES = [16000, 44100, 48000, 96000];

describe('afinador cromático: frecuencia, nombre de nota y cents', () => {
  it.each(TUNER_REFERENCES)('convierte $name sin cambiar A4 = 440 Hz', ({ name, frequency, midi }) => {
    const note = frequencyToNote(frequency);
    expect(`${note.note}${note.octave}`).toBe(name);
    expect(note.midi).toBe(midi);
    expect(note.targetFrequency).toBeCloseTo(frequency, 6);
    expect(Math.abs(note.cents)).toBeLessThan(0.001);
    expect(classifyCents(note.cents)).toBe('Afinado');
  });

  it.each([-35, -12, -5, 0, 5, 12, 35])('calcula una desviación de %ic', (cents) => {
    const note = frequencyToNote(110 * 2 ** (cents / 1200));
    expect(note.midi).toBe(45);
    expect(note.cents).toBeCloseTo(cents, 6);
    expect(classifyCents(cents)).toBe(Math.abs(cents) <= 5 ? 'Afinado' : cents < 0 ? 'Grave' : 'Agudo');
  });

  it('rechaza frecuencias y referencias inválidas', () => {
    for (const invalid of [0, -1, NaN, Infinity, undefined]) {
      expect(frequencyToNote(invalid)).toBeNull();
      if (invalid !== undefined) expect(frequencyToNote(440, invalid)).toBeNull();
    }
    expect(classifyCents(NaN)).toBe('Sin señal');
    expect(frequencyToNote(41.203445).octave).toBe(1);
  });
});

describe('YIN: precisión cuantitativa y selección de fundamental', () => {
  it.each(SAMPLE_RATES)('mide referencias y desafinaciones a %i Hz con error <=2c', (sampleRate) => {
    for (const { frequency, midi } of TUNER_REFERENCES) {
      for (const cents of [-35, -12, 0, 12, 35]) {
        for (const { harmonics, name } of TUNER_TIMBRES) {
          const expected = frequency * 2 ** (cents / 1200);
          const detection = detectPitchYin(tunerSignal({ frequency, cents, sampleRate, harmonics, phase: 0.31 }), sampleRate);
          const label = `${frequency} Hz ${cents}c ${name}`;
          expect(detection.frequency, label).not.toBeNull();
          expect(Math.abs(pitchErrorCents(detection.frequency, expected)), label).toBeLessThanOrEqual(2);
          const note = frequencyToNote(detection.frequency);
          expect(note.midi, label).toBe(midi);
          expect(Math.abs(note.cents - cents), label).toBeLessThanOrEqual(2);
          expect(detection.probability, label).toBeGreaterThanOrEqual(0.86);
        }
      }
    }
  });

  it.each(SAMPLE_RATES)('conserva graves, agudos y distintas fases a %i Hz con error <=2c', (sampleRate) => {
    for (const frequency of [35, 41.203445, 880, 1046.502261, 1174.659072, 1200]) {
      for (const { harmonics, name } of TUNER_TIMBRES) {
        for (const phase of [0, 0.31, 1.4]) {
          const detection = detectPitchYin(tunerSignal({ frequency, sampleRate, harmonics, phase }), sampleRate);
          const label = `${frequency} Hz ${name} fase ${phase}`;
          expect(detection.frequency, label).not.toBeNull();
          expect(Math.abs(pitchErrorCents(detection.frequency, frequency)), label).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it.each(SAMPLE_RATES)('distingue la fundamental tenue y no inventa suboctavas en 100 frecuencias a %i Hz', (sampleRate) => {
    for (let index = 0; index < 100; index += 1) {
      const frequency = 35 * (1200 / 35) ** (index / 99);
      for (const harmonics of [[0.5], [0.01, 0.7, 0]]) {
        for (const noise of [0, 0.01]) {
          const detection = detectPitchYin(tunerSignal({ frequency, sampleRate, harmonics, noise, phase: index * 0.37, seed: index + 1 }), sampleRate);
          expect(detection.frequency).not.toBeNull();
          expect(Math.abs(pitchErrorCents(detection.frequency, frequency))).toBeLessThanOrEqual(3);
        }
      }
      // Strong noise can reduce precision or cause rejection, but lowering the
      // evidence floor must never make a sinusoid acquire a false suboctave.
      for (const noise of [0.1, 0.2]) {
        const detection = detectPitchYin(tunerSignal({ frequency, sampleRate, harmonics: [0.5], noise, phase: index * 0.37, seed: index + 1 }), sampleRate);
        if (detection.frequency) expect(Math.abs(pitchErrorCents(detection.frequency, frequency))).toBeLessThan(700);
      }
    }
  });

  it('acepta una cuerda débil identificable y rechaza señal por debajo del umbral', () => {
    const weak = detectPitchYin(tunerSignal({ frequency: 82.406889, harmonics: [0.006], noise: 0.0005 }), 48000);
    expect(weak.frequency).not.toBeNull();
    expect(Math.abs(pitchErrorCents(weak.frequency, 82.406889))).toBeLessThanOrEqual(2);
    const tooWeak = detectPitchYin(tunerSignal({ harmonics: [0.001] }), 48000);
    expect(tooWeak.frequency).toBeNull();
    expect(tooWeak.reason).toBe('insufficient_signal');
    expect(detectPitchYin(tunerSignal({ harmonics: [0.006], noise: 0.05 }), 48000).frequency).toBeNull();
  });

  it('conserva precisión <=3c con armónicos, caída de amplitud, ruido y offset DC', () => {
    for (const { frequency } of TUNER_REFERENCES) {
      for (let seed = 1; seed <= 8; seed += 1) {
        const detection = detectPitchYin(tunerSignal({
          frequency, harmonics: [0.08, 0.7, 0.02], noise: 0.02, dc: 0.2,
          decaySeconds: 0.3, seed, phase: seed * 0.37
        }), 48000);
        expect(detection.frequency).not.toBeNull();
        expect(Math.abs(pitchErrorCents(detection.frequency, frequency))).toBeLessThanOrEqual(3);
      }
    }
  });

  it('no inventa notas en silencio, offset DC ni ruido blanco/coloreado', () => {
    expect(detectPitchYin(new Float32Array(4096), 48000).reason).toBe('insufficient_signal');
    expect(detectPitchYin(new Float32Array(4096).fill(0.5), 48000).reason).toBe('insufficient_signal');
    for (let seed = 1; seed <= 20; seed += 1) {
      const noise = tunerSignal({ harmonics: [], noise: 0.05, seed, dc: 0.2 });
      expect(detectPitchYin(noise, 48000).frequency).toBeNull();
      let previous = 0;
      const coloredNoise = Float32Array.from(noise, (sample) => {
        previous = previous * 0.92 + (sample - 0.2) * 0.08;
        return previous;
      });
      expect(detectPitchYin(coloredNoise, 48000).frequency).toBeNull();
    }
  });

  it('reutiliza los buffers por captura sin conservar mediciones anteriores', () => {
    const workspace = {};
    const first = detectPitchYin(tunerSignal({ frequency: 110 }), 48000, { workspace });
    const { samples, cumulative, filter } = workspace;
    const second = detectPitchYin(tunerSignal({ frequency: 440 }), 48000, { workspace });
    expect(workspace.samples).toBe(samples);
    expect(workspace.cumulative).toBe(cumulative);
    expect(workspace.filter).toBe(filter);
    expect(Math.abs(pitchErrorCents(first.frequency, 110))).toBeLessThanOrEqual(2);
    expect(Math.abs(pitchErrorCents(second.frequency, 440))).toBeLessThanOrEqual(2);
  });

  it('rechaza entrada vacía, no finita, tasa inválida y frecuencia fuera del rango', () => {
    expect(detectPitchYin(new Float32Array(), 48000).frequency).toBeNull();
    expect(detectPitchYin(new Float32Array(4096).fill(NaN), 48000).frequency).toBeNull();
    expect(detectPitchYin(tunerSignal(), 0).frequency).toBeNull();
    expect(detectPitchYin(tunerSignal({ frequency: 20 }), 48000).frequency).toBeNull();
  });
});

describe('estabilizador a intervalos de 40 ms', () => {
  it('confirma inicialmente en 80ms y no conserva una medición perdida', () => {
    const stabilizer = createPitchStabilizer();
    expect(stabilizer.update({ frequency: 110 }, 0).stable).toBe(false);
    expect(stabilizer.update({ frequency: 110.2 }, 40).stable).toBe(false);
    const result = stabilizer.update({ frequency: 109.9 }, 80);
    expect(result.stable).toBe(true);
    expect(result.note.midi).toBe(45);
    expect(stabilizer.update({ frequency: null, reason: 'insufficient_signal' }, 120)).toEqual({
      stable: false, reason: 'insufficient_signal'
    });
    expect(stabilizer.update({ frequency: 220 }, 160).stable).toBe(false);
    expect(stabilizer.update({ frequency: 220 }, 200).stable).toBe(false);
    expect(stabilizer.update({ frequency: 220 }, 240).note.octave).toBe(3);
  });

  it('sigue todas las cuerdas y cambios reales de octava en 80ms, sin locking', () => {
    const stabilizer = createPitchStabilizer();
    let time = 0;
    for (const frequency of [110, 220, 440, 110, 82.406889, 146.832384, 195.997718, 246.941651, 329.627557]) {
      expect(stabilizer.update({ frequency }, time).stable).toBe(false);
      expect(stabilizer.update({ frequency }, time + 40).stable).toBe(false);
      const result = stabilizer.update({ frequency }, time + 80);
      expect(result.stable).toBe(true);
      expect(result.note.midi).toBe(frequencyToNote(frequency).midi);
      expect(Math.abs(pitchErrorCents(result.note.frequency, frequency))).toBeLessThanOrEqual(2);
      time += 120;
    }
  });

  it('no publica un salto aislado de octava y requiere continuidad para cambiar nota', () => {
    const stabilizer = createPitchStabilizer();
    for (let time = 0; time <= 120; time += 40) {
      stabilizer.update({ frequency: 110 }, time);
    }
    const transient = stabilizer.update({ frequency: 220 }, 160);
    expect(transient.stable).toBe(false);
    expect(transient.note).toBeUndefined();
    for (let time = 200; time <= 280; time += 40) {
      const result = stabilizer.update({ frequency: 110 }, time);
      if (result.stable) expect(result.note.midi).toBe(45);
    }
  });

  it('reduce el movimiento de cents y responde a una corrección de afinación en <=160ms', () => {
    const stabilizer = createPitchStabilizer();
    for (let time = 0; time <= 160; time += 40) {
      stabilizer.update({ frequency: 110 }, time);
    }
    let result;
    for (let time = 200; time <= 360; time += 40) {
      result = stabilizer.update({ frequency: 110 * 2 ** (12 / 1200) }, time);
    }
    expect(result.stable).toBe(true);
    expect(Math.abs(result.note.cents - 12)).toBeLessThanOrEqual(2);

    stabilizer.reset();
    const raw = [];
    const filtered = [];
    for (let index = 0; index < 60; index += 1) {
      const cents = index % 2 ? 4 : -4;
      const reading = stabilizer.update({ frequency: 110 * 2 ** (cents / 1200) }, index * 40);
      if (index > 10 && reading.stable) {
        raw.push(cents);
        filtered.push(reading.note.cents);
      }
    }
    expect(standardDeviation(filtered)).toBeLessThan(standardDeviation(raw) * 0.4);
  });

  it('no acepta tres cuadros repetidos antes de 60ms, ni baja confianza', () => {
    const stabilizer = createPitchStabilizer();
    for (const time of [0, 1, 2]) {
      expect(stabilizer.update({ frequency: 110 }, time).stable).toBe(false);
    }
    expect(stabilizer.update({ frequency: 110, probability: 0.3 }, 80).stable).toBe(false);
    expect(stabilizer.update({ frequency: 110 }, 120).stable).toBe(false);
  });
});

describe('liberación del micrófono', () => {
  it('libera todas las pistas aunque alguna haya fallado', () => {
    const tracks = [{ stop: vi.fn(() => { throw new Error('ended'); }) }, { stop: vi.fn() }];
    expect(() => stopMediaStream({ getTracks: () => tracks })).not.toThrow();
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(() => stopMediaStream(null)).not.toThrow();
  });
});

function standardDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}
