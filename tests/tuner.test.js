import { describe, expect, it, vi } from 'vitest';
import {
  classifyCents,
  createPitchStabilizer,
  detectPitchYin,
  frequencyToNote,
  stopMediaStream
} from '../public/js/tuner-core.js';

describe('afinador cromático', () => {
  it('convierte A4 440 Hz a A4 con 0 cents', () => {
    const note = frequencyToNote(440);

    expect(note.note).toBe('A');
    expect(note.octave).toBe(4);
    expect(note.targetFrequency).toBeCloseTo(440, 6);
    expect(note.cents).toBeCloseTo(0, 6);
    expect(classifyCents(note.cents)).toBe('Afinado');
  });

  it('calcula cents positivos y negativos', () => {
    const sharp = frequencyToNote(445);
    const flat = frequencyToNote(435);

    expect(sharp.cents).toBeGreaterThan(0);
    expect(classifyCents(sharp.cents)).toBe('Agudo');
    expect(flat.cents).toBeLessThan(0);
    expect(classifyCents(flat.cents)).toBe('Grave');
  });

  it('detecta notas y octavas cromáticas, incluyendo bajo', () => {
    expect(frequencyToNote(261.625565).note).toBe('C');
    expect(frequencyToNote(261.625565).octave).toBe(4);
    expect(frequencyToNote(82.406889).note).toBe('E');
    expect(frequencyToNote(82.406889).octave).toBe(2);
    expect(frequencyToNote(41.203445).note).toBe('E');
    expect(frequencyToNote(41.203445).octave).toBe(1);
  });

  it('detecta pitch con YIN sobre una señal sintética', () => {
    const sampleRate = 44100;
    const buffer = sineBuffer({ frequency: 110, sampleRate, length: 4096, amplitude: 0.8 });
    const result = detectPitchYin(buffer, sampleRate);

    expect(result.frequency).toBeCloseTo(110, 0);
    expect(result.probability).toBeGreaterThan(0.8);
  });

  it('ignora señales insuficientes', () => {
    const result = detectPitchYin(new Float32Array(4096), 44100);

    expect(result.frequency).toBeNull();
    expect(result.reason).toBe('insufficient_signal');
  });

  it('estabiliza lecturas moderadamente y reduce saltos de octava', () => {
    const stabilizer = createPitchStabilizer();

    expect(stabilizer.update({ frequency: 110 }).stable).toBe(false);
    expect(stabilizer.update({ frequency: 110.2 }).stable).toBe(false);
    expect(stabilizer.update({ frequency: 109.9 }).stable).toBe(true);
    expect(stabilizer.update({ frequency: 220.1 }).note.note).toBe('A');
  });

  it('libera todas las pistas del micrófono', () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    stopMediaStream({ getTracks: () => tracks });

    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(tracks[1].stop).toHaveBeenCalledTimes(1);
  });
});

function sineBuffer({ frequency, sampleRate, length, amplitude }) {
  const buffer = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    buffer[index] = Math.sin(2 * Math.PI * frequency * (index / sampleRate)) * amplitude;
  }
  return buffer;
}
