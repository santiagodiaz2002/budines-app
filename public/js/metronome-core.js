export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const MIN_MEASURES = 1;
export const MAX_MEASURES = 999;
export const BEATS_PER_MEASURE = 4;

export const DEFAULT_BLOCKS = [
  { measures: 4, bpm: 100 },
  { measures: 8, bpm: 120 },
  { measures: 2, bpm: 140 }
];

const STRICT_INTEGER_PATTERN = /^[0-9]+$/;

export function parseStrictInteger(raw, { min, max, label }) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, message: `${label} es obligatorio.` };
  }

  const valueText = raw.trim();
  if (!STRICT_INTEGER_PATTERN.test(valueText)) {
    return { ok: false, message: `${label} debe ser un entero entre ${min} y ${max}.` };
  }

  const value = Number(valueText);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return { ok: false, message: `${label} debe estar entre ${min} y ${max}.` };
  }

  return { ok: true, value };
}

export function parseBpm(raw) {
  return parseStrictInteger(raw, { min: MIN_BPM, max: MAX_BPM, label: 'BPM' });
}

export function parseMeasures(raw) {
  return parseStrictInteger(raw, { min: MIN_MEASURES, max: MAX_MEASURES, label: 'Compases' });
}

export function normalizeBlocks(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_BLOCKS.map((block) => ({ ...block }));
  }

  const blocks = [];
  for (const block of value) {
    if (
      !block ||
      !Number.isInteger(block.measures) ||
      !Number.isInteger(block.bpm) ||
      block.measures < MIN_MEASURES ||
      block.measures > MAX_MEASURES ||
      block.bpm < MIN_BPM ||
      block.bpm > MAX_BPM
    ) {
      return DEFAULT_BLOCKS.map((defaultBlock) => ({ ...defaultBlock }));
    }
    blocks.push({
      measures: block.measures,
      bpm: block.bpm
    });
  }

  return blocks;
}

export function createRuntime(blocks) {
  const normalized = normalizeBlocks(blocks);
  return {
    blockIndex: 0,
    measureInBlock: 1,
    beatInMeasure: 1,
    bpm: normalized[0].bpm
  };
}

export function advanceRuntime(runtime, blocks) {
  const normalized = normalizeBlocks(blocks);
  const currentBlock = normalized[runtime.blockIndex] || normalized[0];
  let blockIndex = runtime.blockIndex;
  let measureInBlock = runtime.measureInBlock;
  let beatInMeasure = runtime.beatInMeasure + 1;

  if (beatInMeasure > BEATS_PER_MEASURE) {
    beatInMeasure = 1;
    measureInBlock += 1;

    if (measureInBlock > currentBlock.measures) {
      blockIndex = (blockIndex + 1) % normalized.length;
      measureInBlock = 1;
    }
  }

  return {
    blockIndex,
    measureInBlock,
    beatInMeasure,
    bpm: normalized[blockIndex].bpm
  };
}

export function getCurrentBlock(runtime, blocks) {
  const normalized = normalizeBlocks(blocks);
  return normalized[runtime.blockIndex] || normalized[0];
}

export function createMetronomeMachine(blocks) {
  const normalized = normalizeBlocks(blocks);
  let runtime = createRuntime(normalized);
  let running = false;
  let paused = false;
  let schedulerActive = false;

  return {
    start() {
      if (schedulerActive) {
        return false;
      }
      running = true;
      paused = false;
      schedulerActive = true;
      return true;
    },
    pause() {
      if (!running || paused) {
        return false;
      }
      paused = true;
      schedulerActive = false;
      return true;
    },
    resume() {
      if (!running || !paused || schedulerActive) {
        return false;
      }
      paused = false;
      schedulerActive = true;
      return true;
    },
    stop() {
      running = false;
      paused = false;
      schedulerActive = false;
      runtime = createRuntime(normalized);
    },
    tick() {
      runtime = advanceRuntime(runtime, normalized);
      return this.snapshot();
    },
    snapshot() {
      return {
        runtime: { ...runtime },
        running,
        paused,
        schedulerActive
      };
    }
  };
}
