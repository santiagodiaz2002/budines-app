export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const A4_FREQUENCY = 440;
const A4_MIDI = 69;
const MIN_RMS = 0.012;

export function frequencyToNote(frequency, reference = A4_FREQUENCY) {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return null;
  }

  const midiFloat = A4_MIDI + 12 * Math.log2(frequency / reference);
  const midi = Math.round(midiFloat);
  const noteIndex = ((midi % 12) + 12) % 12;
  const targetFrequency = reference * 2 ** ((midi - A4_MIDI) / 12);
  const cents = 1200 * Math.log2(frequency / targetFrequency);

  return {
    note: NOTE_NAMES[noteIndex],
    octave: Math.floor(midi / 12) - 1,
    midi,
    frequency,
    targetFrequency,
    cents
  };
}

export function classifyCents(cents) {
  if (!Number.isFinite(cents)) {
    return 'Sin señal';
  }
  if (Math.abs(cents) <= 5) {
    return 'Afinado';
  }
  return cents < 0 ? 'Grave' : 'Agudo';
}

export function detectPitchYin(buffer, sampleRate, options = {}) {
  const threshold = options.threshold ?? 0.14;
  const minFrequency = options.minFrequency ?? 35;
  const maxFrequency = options.maxFrequency ?? 1200;
  const rms = calculateRms(buffer);

  if (rms < (options.minRms ?? MIN_RMS)) {
    return {
      frequency: null,
      probability: 0,
      rms,
      reason: 'insufficient_signal'
    };
  }

  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxTau = Math.min(buffer.length - 1, Math.ceil(sampleRate / minFrequency));
  const difference = new Float32Array(maxTau + 1);

  for (let tau = minTau; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let index = 0; index < buffer.length - tau; index += 1) {
      const delta = buffer[index] - buffer[index + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  let runningSum = 0;
  const cumulative = new Float32Array(maxTau + 1);
  cumulative[0] = 1;

  for (let tau = minTau; tau <= maxTau; tau += 1) {
    runningSum += difference[tau];
    cumulative[tau] = difference[tau] * tau / runningSum;
  }

  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (cumulative[tau] < threshold) {
      while (tau + 1 <= maxTau && cumulative[tau + 1] < cumulative[tau]) {
        tau += 1;
      }
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate === -1) {
    return {
      frequency: null,
      probability: 0,
      rms,
      reason: 'unstable_signal'
    };
  }

  const betterTau = parabolicTau(cumulative, tauEstimate);
  const frequency = sampleRate / betterTau;
  return {
    frequency,
    probability: 1 - cumulative[tauEstimate],
    rms,
    reason: null
  };
}

export function createPitchStabilizer({ centsTolerance = 18, historySize = 5 } = {}) {
  let history = [];
  let lastMidi = null;

  return {
    update(detection) {
      if (!detection || !Number.isFinite(detection.frequency)) {
        history = [];
        return {
          stable: false,
          reason: detection?.reason || 'insufficient_signal'
        };
      }

      const note = frequencyToNote(detection.frequency);
      if (!note) {
        history = [];
        return { stable: false, reason: 'unstable_signal' };
      }

      let correctedFrequency = detection.frequency;
      let correctedNote = note;
      if (lastMidi !== null && Math.abs(note.midi - lastMidi) === 12) {
        const octaveAdjusted = detection.frequency * (note.midi > lastMidi ? 0.5 : 2);
        const adjustedNote = frequencyToNote(octaveAdjusted);
        if (adjustedNote && Math.abs(adjustedNote.midi - lastMidi) <= 1) {
          correctedFrequency = octaveAdjusted;
          correctedNote = adjustedNote;
        }
      }

      history.push(correctedFrequency);
      history = history.slice(-historySize);
      const medianFrequency = median(history);
      const stableNote = frequencyToNote(medianFrequency);

      if (!stableNote) {
        return { stable: false, reason: 'unstable_signal' };
      }

      const closeReadings = history.filter((frequency) => {
        const reading = frequencyToNote(frequency);
        return reading && reading.midi === stableNote.midi && Math.abs(reading.cents - stableNote.cents) <= centsTolerance;
      });

      const stable = history.length >= 3 && closeReadings.length >= 3;
      if (stable) {
        lastMidi = stableNote.midi;
      } else {
        lastMidi = correctedNote.midi;
      }

      return {
        stable,
        reason: stable ? null : 'unstable_signal',
        note: stableNote
      };
    },
    reset() {
      history = [];
      lastMidi = null;
    }
  };
}

export function stopMediaStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    track.stop();
  }
}

function calculateRms(buffer) {
  let sum = 0;
  for (const sample of buffer) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / buffer.length);
}

function parabolicTau(values, tau) {
  const left = values[tau - 1];
  const center = values[tau];
  const right = values[tau + 1];
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return tau;
  }

  const divisor = 2 * (2 * center - right - left);
  if (divisor === 0) {
    return tau;
  }
  return tau + (right - left) / divisor;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
