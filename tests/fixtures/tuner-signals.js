export const TUNER_REFERENCES = [
  { name: 'E2', frequency: 82.4068892282175, midi: 40 },
  { name: 'A2', frequency: 110, midi: 45 },
  { name: 'D3', frequency: 146.832383958704, midi: 50 },
  { name: 'G3', frequency: 195.997717990875, midi: 55 },
  { name: 'B3', frequency: 246.941650628062, midi: 59 },
  { name: 'E4', frequency: 329.62755691287, midi: 64 },
  { name: 'A4', frequency: 440, midi: 69 }
];

export const TUNER_TIMBRES = [
  { name: 'seno', harmonics: [0.5] },
  { name: 'segundo dominante', harmonics: [0.08, 0.7, 0.02] },
  { name: 'tercero dominante', harmonics: [0.06, 0.03, 0.7] },
  { name: 'fundamental tenue y segundo dominante', harmonics: [0.02, 0.7, 0.02] },
  { name: 'fundamental 37 dB bajo el segundo, sin tercer parcial', harmonics: [0.01, 0.7, 0] },
  { name: 'cuerda simulada', harmonics: [0.3, 0.35, 0.2, 0.1] },
  { name: 'fundamental ausente con parciales 2 y 3', harmonics: [0, 0.7, 0.2] }
];

export function tunerBufferLength(sampleRate) {
  return 2 ** Math.ceil(Math.log2(sampleRate * 0.085));
}

// Deterministic local samples, not recordings of an acoustic instrument.
export function tunerSignal({
  frequency = 440,
  cents = 0,
  sampleRate = 48000,
  length = tunerBufferLength(sampleRate),
  harmonics = [0.5],
  phase = 0,
  noise = 0,
  dc = 0,
  seed = 12,
  decaySeconds = Infinity,
  startSample = 0
} = {}) {
  const actualFrequency = frequency * 2 ** (cents / 1200);
  return Float32Array.from({ length }, (_, index) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const time = (index + startSample) / sampleRate;
    const envelope = Math.exp(-time / decaySeconds);
    const tone = harmonics.reduce((sum, amplitude, harmonic) => (
      sum + amplitude * Math.sin(2 * Math.PI * actualFrequency * (harmonic + 1) * time + phase * (harmonic + 1))
    ), 0);
    return dc + envelope * tone + noise * (2 * seed / 4294967296 - 1);
  });
}

export function pitchErrorCents(actual, expected) {
  return 1200 * Math.log2(actual / expected);
}
