import { performance } from 'node:perf_hooks';
import { createPitchStabilizer, detectPitchYin, frequencyToNote } from '../public/js/tuner-core.js';
import { pitchErrorCents, TUNER_REFERENCES, TUNER_TIMBRES, tunerSignal } from '../tests/fixtures/tuner-signals.js';

const report = { synthetic: true, referenceHz: 440, precision: [], noise: {}, latencyMs: {}, benchmarkMs: [] };
for (const sampleRate of [16000, 44100, 48000, 96000]) {
  let count = 0;
  let failures = 0;
  let maxErrorCents = 0;
  const errors = [];
  for (const frequency of [...TUNER_REFERENCES.map((reference) => reference.frequency), 35, 41.203445, 880, 1046.502261, 1174.659072, 1200]) {
    for (const { harmonics } of TUNER_TIMBRES) {
      for (const cents of frequency >= 82 && frequency <= 880 ? [-35, -12, 0, 12, 35] : [0]) {
        for (const phase of [0, 0.31, 1.4]) {
          const expected = frequency * 2 ** (cents / 1200);
          const result = detectPitchYin(tunerSignal({ frequency, sampleRate, harmonics, cents, phase }), sampleRate);
          const error = result.frequency ? Math.abs(pitchErrorCents(result.frequency, expected)) : Infinity;
          maxErrorCents = Math.max(maxErrorCents, error);
          failures += error > 2 ? 1 : 0;
          errors.push(error);
          count += 1;
        }
      }
    }
  }
  errors.sort((a, b) => a - b);
  report.precision.push({ sampleRate, count, failures, maxErrorCents, p95ErrorCents: errors[Math.floor(errors.length * 0.95)] });
}

report.references48k = TUNER_REFERENCES.map(({ name, frequency }) => {
  const result = detectPitchYin(tunerSignal({ frequency }), 48000);
  const note = frequencyToNote(result.frequency);
  return { name, expectedHz: frequency, detectedHz: result.frequency, cents: note.cents };
});
let noiseFalsePositives = 0;
let weakAccepted = 0;
let noisyMaxErrorCents = 0;
for (let seed = 1; seed <= 100; seed += 1) {
  noiseFalsePositives += detectPitchYin(tunerSignal({ harmonics: [], noise: 0.05, seed }), 48000).frequency ? 1 : 0;
  weakAccepted += detectPitchYin(tunerSignal({ frequency: 82.406889, harmonics: [0.006], noise: 0.0005, seed }), 48000).frequency ? 1 : 0;
  const noisy = detectPitchYin(tunerSignal({ frequency: 110, harmonics: [0.08, 0.7, 0.02], noise: 0.02, decaySeconds: 0.3, seed }), 48000);
  noisyMaxErrorCents = Math.max(noisyMaxErrorCents, noisy.frequency ? Math.abs(pitchErrorCents(noisy.frequency, 110)) : Infinity);
}
report.noise = { samplesPerGroup: 100, noiseFalsePositives, weakAccepted, noisyMaxErrorCents };

report.harmonicStress = { count: 0, octaveErrors: 0, moderateNoiseFailures: 0, moderateNoiseMaxErrorCents: 0, strongNoiseRejections: 0 };
for (const sampleRate of [16000, 44100, 48000, 96000]) {
  for (let index = 0; index < 100; index += 1) {
    const frequency = 35 * (1200 / 35) ** (index / 99);
    for (const [harmonics, noise] of [[ [0.5], 0 ], [ [0.5], 0.01 ], [ [0.01, 0.7, 0], 0 ], [ [0.01, 0.7, 0], 0.01 ], [ [0.5], 0.1 ], [ [0.5], 0.2 ]]) {
      const result = detectPitchYin(tunerSignal({ frequency, sampleRate, harmonics, noise, phase: index * 0.37, seed: index + 1 }), sampleRate);
      const error = result.frequency ? Math.abs(pitchErrorCents(result.frequency, frequency)) : Infinity;
      report.harmonicStress.count += 1;
      if (result.frequency && error >= 700) report.harmonicStress.octaveErrors += 1;
      if (noise <= 0.01) {
        report.harmonicStress.moderateNoiseMaxErrorCents = Math.max(report.harmonicStress.moderateNoiseMaxErrorCents, error);
        if (error > 3) report.harmonicStress.moderateNoiseFailures += 1;
      } else if (!result.frequency) {
        report.harmonicStress.strongNoiseRejections += 1;
      }
    }
  }
}

const stabilizer = createPitchStabilizer();
for (let now = 0; now <= 160; now += 40) {
  const result = stabilizer.update({ frequency: 110 }, now);
  if (result.stable && report.latencyMs.initialConfirmation === undefined) report.latencyMs.initialConfirmation = now;
}
for (let now = 200; now <= 360; now += 40) {
  const result = stabilizer.update({ frequency: 220 }, now);
  if (result.stable && result.note.midi === 57 && report.latencyMs.octaveConfirmation === undefined) report.latencyMs.octaveConfirmation = now - 200;
}
for (let now = 400; now <= 640; now += 40) {
  const result = stabilizer.update({ frequency: 220 * 2 ** (12 / 1200) }, now);
  if (result.stable && Math.abs(result.note.cents - 12) <= 2 && report.latencyMs.correction12Cents === undefined) report.latencyMs.correction12Cents = now - 400;
}
report.latencyMs.captureWindow48k = 4096 / 48000 * 1000;
// This estimate excludes capture/device latency, CPU time and scheduling delays.
report.latencyMs.estimatedWindowPlusConfirmation = report.latencyMs.captureWindow48k + 40 + report.latencyMs.initialConfirmation;

for (const { label, buffer } of [
  { label: '35 Hz', buffer: tunerSignal({ frequency: 35 }) },
  { label: 'E2', buffer: tunerSignal({ frequency: 82.406889 }) },
  { label: '1174.659 Hz', buffer: tunerSignal({ frequency: 1174.659 }) },
  { label: 'silencio', buffer: new Float32Array(4096) },
  { label: 'ruido', buffer: tunerSignal({ harmonics: [], noise: 0.05 }) }
]) {
  const workspace = {};
  for (let index = 0; index < 20; index += 1) detectPitchYin(buffer, 48000, { workspace });
  const started = performance.now();
  for (let index = 0; index < 200; index += 1) detectPitchYin(buffer, 48000, { workspace });
  report.benchmarkMs.push({ label, averageMs: (performance.now() - started) / 200 });
}
const latencyWithinBudget = [
  ['initialConfirmation', 120],
  ['octaveConfirmation', 120],
  ['correction12Cents', 160]
].every(([metric, budget]) => Number.isFinite(report.latencyMs[metric]) && report.latencyMs[metric] <= budget);
report.passed = !report.precision.some((measurement) => measurement.failures)
  && noiseFalsePositives === 0 && weakAccepted === 100
  && Number.isFinite(noisyMaxErrorCents) && noisyMaxErrorCents <= 3
  && report.harmonicStress.octaveErrors === 0 && report.harmonicStress.moderateNoiseFailures === 0
  && latencyWithinBudget;
console.log(JSON.stringify(report, null, 2));
if (!report.passed) {
  process.exitCode = 1;
}
