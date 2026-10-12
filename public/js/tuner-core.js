export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const A4_FREQUENCY = 440;
const A4_MIDI = 69;
const MIN_RMS = 0.003;

export function frequencyToNote(frequency, reference = A4_FREQUENCY) {
  if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(reference) || reference <= 0) {
    return null;
  }
  return noteForMidi(frequency, Math.round(A4_MIDI + 12 * Math.log2(frequency / reference)), reference);
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

// Equal-length comparisons and the complete cumulative sum are essential to YIN.
// A reusable workspace belongs to one capture; no audio leaves this function.
export function detectPitchYin(buffer, sampleRate, options = {}) {
  const threshold = options.threshold ?? 0.14;
  const minFrequency = options.minFrequency ?? 35;
  const maxFrequency = options.maxFrequency ?? 1200;
  if (!buffer?.length || !Number.isFinite(sampleRate) || sampleRate <= 0 || minFrequency <= 0 || maxFrequency <= minFrequency) {
    return noPitch(0, 'insufficient_signal');
  }

  let mean = 0;
  for (const sample of buffer) {
    if (!Number.isFinite(sample)) {
      return noPitch(0, 'unstable_signal');
    }
    mean += sample;
  }
  mean /= buffer.length;
  let energy = 0;
  for (const sample of buffer) {
    energy += (sample - mean) ** 2;
  }
  const rms = Math.sqrt(energy / buffer.length);
  if (rms < (options.minRms ?? MIN_RMS)) {
    return noPitch(rms, 'insufficient_signal');
  }

  const workspace = options.workspace ?? {};
  const factor = Math.max(1, Math.floor(sampleRate / 16000));
  const samples = prepareSamples(buffer, mean, factor, workspace);
  const analysisRate = sampleRate / factor;
  const minTau = Math.max(2, Math.floor(analysisRate / maxFrequency));
  const maxTau = Math.min(Math.ceil(analysisRate / minFrequency) + 1, Math.floor(samples.length / 2));
  if (maxTau <= minTau + 1) {
    return noPitch(rms, 'insufficient_signal');
  }

  const cumulative = reusableArray(workspace, 'cumulative', maxTau + 1);
  cumulative[0] = 1;
  const comparisonLength = samples.length - maxTau;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    let difference = 0;
    for (let index = 0; index < comparisonLength; index += 1) {
      const delta = samples[index] - samples[index + tau];
      difference += delta * delta;
    }
    runningSum += difference;
    cumulative[tau] = runningSum > 0 ? difference * tau / runningSum : 1;
  }

  let candidate = null;
  for (let tau = minTau; tau < maxTau; tau += 1) {
    if (cumulative[tau] < threshold && cumulative[tau] <= cumulative[tau - 1] && cumulative[tau] <= cumulative[tau + 1]) {
      candidate = refineMinimum(buffer, sampleRate, minFrequency, interpolateMinimum(cumulative, tau).tau * factor, rms);
      break;
    }
  }
  if (!candidate) {
    return noPitch(rms, 'unstable_signal');
  }

  // A strong second/third harmonic can create an early, shallow valley. Prefer
  // a longer period only when its interpolated depth improves materially; merely
  // finding another period must never halve a pure tone's frequency.
  const firstTau = candidate.tau / factor;
  const end = Math.min(maxTau - 1, Math.ceil(firstTau * 4));
  for (let tau = Math.floor(firstTau) + 2; tau <= end; tau += 1) {
    if (cumulative[tau] < threshold && cumulative[tau] <= cumulative[tau - 1] && cumulative[tau] <= cumulative[tau + 1]) {
      const alternative = refineMinimum(buffer, sampleRate, minFrequency, interpolateMinimum(cumulative, tau).tau * factor, rms);
      if (candidate.depth - alternative.depth > 0.00001 && alternative.depth < candidate.depth * 0.55
          && hasFundamentalEvidence(buffer, sampleRate, sampleRate / alternative.tau, rms, mean, workspace)) {
        candidate = alternative;
      }
    }
  }

  const frequency = sampleRate / candidate.tau;
  if (!Number.isFinite(frequency) || frequency < minFrequency * 0.998 || frequency > maxFrequency * 1.002) {
    return noPitch(rms, 'unstable_signal');
  }
  return {
    frequency,
    probability: Math.max(0, Math.min(1, 1 - candidate.depth)),
    rms,
    reason: null
  };
}

export function createPitchStabilizer({ centsTolerance = 18, historySize = 3 } = {}) {
  let history = [];
  let candidateSince = null;
  let confirmedMidi = null;
  let smoothedMidi = null;
  let lastTime = null;

  function reset() {
    history = [];
    candidateSince = null;
    confirmedMidi = null;
    smoothedMidi = null;
    lastTime = null;
  }

  return {
    update(detection, nowMs) {
      const note = frequencyToNote(detection?.frequency);
      if (!note || (Number.isFinite(detection?.probability) && detection.probability < 0.86)) {
        reset();
        return { stable: false, reason: detection?.reason || 'unstable_signal' };
      }

      const midiFloat = A4_MIDI + 12 * Math.log2(note.frequency / A4_FREQUENCY);
      const timed = Number.isFinite(nowMs);
      const now = timed ? nowMs : (lastTime ?? -40) + 40;
      const elapsed = lastTime === null ? 40 : Math.max(1, Math.min(160, now - lastTime));
      lastTime = now;

      // Confirmation is about continuity, not the old note. A real octave change
      // follows the same short confirmation as any other new pitch.
      if (history.length && Math.abs(midiFloat - median(history)) * 100 > centsTolerance) {
        history = [];
        candidateSince = null;
      }
      if (!history.length) {
        candidateSince = now;
      }
      history.push(midiFloat);
      history = history.slice(-Math.max(3, historySize));
      const medianMidi = median(history);
      const readingsAgree = history.length >= 3 && history.every((value) => Math.abs(value - medianMidi) * 100 <= centsTolerance);
      const confirmed = readingsAgree && now - candidateSince >= 60;
      if (!confirmed) {
        return { stable: false, reason: 'unstable_signal' };
      }

      // Reset smoothing on a musical jump. Small tuning movements use a short,
      // adaptive time constant so the needle settles without freezing.
      if (smoothedMidi === null || Math.abs(medianMidi - smoothedMidi) * 100 > centsTolerance) {
        smoothedMidi = medianMidi;
        confirmedMidi = Math.round(medianMidi);
      } else {
        const deltaCents = Math.abs(medianMidi - smoothedMidi) * 100;
        const timeConstant = deltaCents > 8 ? 35 : 65;
        smoothedMidi += (medianMidi - smoothedMidi) * (1 - Math.exp(-elapsed / timeConstant));
      }

      // Three cents of note-name hysteresis prevent flicker at a semitone edge.
      if (Math.abs(smoothedMidi - confirmedMidi) > 0.53) {
        confirmedMidi = Math.round(smoothedMidi);
      }
      const frequency = A4_FREQUENCY * 2 ** ((smoothedMidi - A4_MIDI) / 12);
      return { stable: true, reason: null, note: noteForMidi(frequency, confirmedMidi) };
    },
    reset
  };
}

export function stopMediaStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try {
      track.stop();
    } catch {
      // A failed/ended track must not prevent release of the remaining tracks.
    }
  }
}

function noPitch(rms, reason) {
  return { frequency: null, probability: 0, rms, reason };
}

function noteForMidi(frequency, midi, reference = A4_FREQUENCY) {
  const targetFrequency = reference * 2 ** ((midi - A4_MIDI) / 12);
  return {
    note: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    midi,
    frequency,
    targetFrequency,
    cents: 1200 * Math.log2(frequency / targetFrequency)
  };
}

function reusableArray(workspace, key, length) {
  if (workspace[key]?.length !== length) {
    workspace[key] = new Float32Array(length);
  }
  return workspace[key];
}

function prepareSamples(buffer, mean, factor, workspace) {
  if (factor === 1) {
    const samples = reusableArray(workspace, 'samples', buffer.length);
    for (let index = 0; index < buffer.length; index += 1) {
      samples[index] = buffer[index] - mean;
    }
    return samples;
  }

  // Windowed sinc removes high-frequency energy before downsampling. Keeping
  // >=16 kHz preserves the full chromatic range while reducing the quadratic
  // difference calculation on high-rate/mobile AudioContexts.
  const radius = 8 * factor;
  if (workspace.filterFactor !== factor) {
    const filter = new Float64Array(2 * radius + 1);
    const cutoff = 0.4 / factor;
    let total = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const sinc = offset === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * offset) / (Math.PI * offset);
      const window = 0.5 + 0.5 * Math.cos(Math.PI * offset / radius);
      filter[offset + radius] = sinc * window;
      total += filter[offset + radius];
    }
    for (let index = 0; index < filter.length; index += 1) {
      filter[index] /= total;
    }
    workspace.filter = filter;
    workspace.filterFactor = factor;
  }
  const length = Math.floor((buffer.length - 2 * radius) / factor);
  const samples = reusableArray(workspace, 'samples', Math.max(0, length));
  for (let index = 0; index < samples.length; index += 1) {
    const center = radius + index * factor;
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += (buffer[center + offset] - mean) * workspace.filter[offset + radius];
    }
    samples[index] = sum;
  }
  return samples;
}

function interpolateMinimum(values, index) {
  const left = values[index - 1];
  const center = values[index];
  const right = values[index + 1];
  const denominator = left - 2 * center + right;
  const offset = denominator > 0 ? Math.max(-1, Math.min(1, (left - right) / (2 * denominator))) : 0;
  return { tau: index + offset, depth: Math.max(0, center - (left - right) * offset / 4) };
}

// Refine at the original sample rate with a five-point local polynomial. The
// coarse/downsampled CMND only selects periods; its sampling/normalization bias
// must not affect cents or make a later multiple appear more periodic.
function refineMinimum(buffer, sampleRate, minFrequency, approximateTau, rms) {
  const center = Math.round(approximateTau);
  const length = Math.max(1, buffer.length - Math.ceil(sampleRate / minFrequency) - 3);
  const values = [];
  for (let offset = -2; offset <= 2; offset += 1) {
    const lag = center + offset;
    let difference = 0;
    for (let index = 0; index < length; index += 1) {
      const delta = buffer[index] - buffer[index + lag];
      difference += delta * delta;
    }
    values.push(difference / (2 * rms * rms * length));
  }
  const [left2, left, middle, right, right2] = values;
  const a = (right2 + left2 - 4 * (right + left) + 6 * middle) / 24;
  const b = (right2 - left2 - 2 * (right - left)) / 12;
  const c = (right + left - 2 * middle) / 2 - a;
  const d = (right - left) / 2 - b;
  let offset = Math.max(-1, Math.min(1, approximateTau - center));
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const derivative = 4 * a * offset ** 3 + 3 * b * offset ** 2 + 2 * c * offset + d;
    const curvature = 12 * a * offset ** 2 + 6 * b * offset + 2 * c;
    if (!(curvature > 0)) {
      break;
    }
    offset = Math.max(-1, Math.min(1, offset - derivative / curvature));
  }
  const depth = middle + d * offset + c * offset ** 2 + b * offset ** 3 + a * offset ** 4;
  return { tau: center + offset, depth: Math.max(0, depth) };
}

function hasFundamentalEvidence(buffer, sampleRate, frequency, rms, mean, workspace) {
  if (workspace.window?.length !== buffer.length) {
    const window = reusableArray(workspace, 'window', buffer.length);
    workspace.windowSum = 0;
    for (let index = 0; index < window.length; index += 1) {
      window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (window.length - 1));
      workspace.windowSum += window[index];
    }
  }
  function harmonicPower(harmonic) {
    const angle = 2 * Math.PI * frequency * harmonic / sampleRate;
    const stepCos = Math.cos(angle);
    const stepSin = Math.sin(angle);
    let cosine = 1;
    let sine = 0;
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < buffer.length; index += 1) {
      const sample = (buffer[index] - mean) * workspace.window[index];
      real += sample * cosine;
      imaginary += sample * sine;
      const nextCosine = cosine * stepCos - sine * stepSin;
      sine = sine * stepCos + cosine * stepSin;
      cosine = nextCosine;
    }
    return 2 * (real * real + imaginary * imaginary) / (workspace.windowSum ** 2 * rms * rms);
  }
  // The lower candidate needs spectral evidence. A lone sinusoid provides none
  // at a subharmonic; two distinct partials also allow a missing fundamental.
  return harmonicPower(1) > 0.00001 || (harmonicPower(2) > 0.00001 && harmonicPower(3) > 0.00001);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
