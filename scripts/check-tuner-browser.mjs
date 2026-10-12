// Optional integration check: uses Playwright/Chrome supplied by the host.
// Only generated reference audio enters the fake microphone; no user audio is captured.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'http://127.0.0.1:8788/';
const baseline = process.argv.includes('--baseline');
const phases = [
  { frequency: 110, note: 'A', octave: '2', cents: 0 },
  { frequency: 220, note: 'A', octave: '3', cents: 0 },
  { frequency: 1174.6590717, note: 'D', octave: '6', cents: 0 },
  { frequency: 0 },
  { frequency: 82.406889 * 2 ** (-17 / 1200), note: 'E', octave: '2', cents: -17 },
  { frequency: 110 * 2 ** (19 / 1200), note: 'A', octave: '2', cents: 19, harmonics: [0.08, 0.7, 0.02] },
  { frequency: 440, note: 'A', octave: '4', cents: 0 }
];
const seconds = 2;
const sampleRate = 48000;
const directory = await mkdtemp(join(tmpdir(), 'budines-tuner-'));
const wav = join(directory, 'reference.wav');
const frames = sampleRate * seconds * phases.length;
const data = Buffer.alloc(44 + frames * 2);
data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * 2, 28);
data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
data.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i += 1) {
  const phase = phases[Math.floor(i / (sampleRate * seconds))];
  const amplitudes = phase.harmonics || [0.4];
  const value = amplitudes.reduce((sum, amplitude, h) => sum + amplitude * Math.sin(2 * Math.PI * phase.frequency * (h + 1) * i / sampleRate), 0);
  data.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
}
await writeFile(wav, data);
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.tunerCheck = { streams: [], contexts: [], samples: [] };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await capture(constraints);
      window.tunerCheck.streams.push(stream);
      return stream;
    };
    const Audio = window.AudioContext;
    window.AudioContext = class extends Audio {
      constructor(...args) { super(...args); window.tunerCheck.contexts.push(this); }
    };
  });
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.authState !== 'booting');
  const local = page.locator('#local-tools-button');
  if (await local.isVisible()) await local.click();
  await page.locator('#tab-tuner').click();
  await page.locator('#tuner-start').click();
  await page.waitForFunction(() => window.tunerCheck.streams.length === 1);
  const captureStart = Date.now();
  await page.evaluate(() => {
    window.tunerCheck.startedAt = performance.now();
    window.tunerCheck.timer = setInterval(() => {
      window.tunerCheck.samples.push({ time: performance.now(), state: document.querySelector('#tuner-tool').dataset.tunerState,
        note: document.querySelector('#tuner-note').textContent, octave: document.querySelector('#tuner-octave').textContent,
        cents: parseFloat(document.querySelector('#tuner-cents').textContent), frequency: document.querySelector('#tuner-frequency').textContent });
    }, 40);
  });
  const results = [];
  for (let phase = 0; phase < phases.length; phase += 1) {
    const remaining = captureStart + (phase + 1) * seconds * 1000 - 300 - Date.now();
    if (remaining > 0) await page.waitForTimeout(remaining);
    const reading = await page.evaluate(() => window.tunerCheck.samples.slice(-5));
    const expected = phases[phase];
    const matched = reading.length >= 3 && reading.every(r => expected.frequency
      ? ['signal', 'in-tune'].includes(r.state) && r.note === expected.note && r.octave === expected.octave
        && Number.isFinite(r.cents) && Math.abs(r.cents - expected.cents) < 2
        && Math.abs(1200 * Math.log2(parseFloat(r.frequency) / expected.frequency)) < 2
      : ['-- Hz', '— Hz'].includes(r.frequency) && ['listening', 'requesting'].includes(r.state) && !Number.isFinite(r.cents));
    results.push({ phase, expected, reading: reading.at(-1), matched });
  }
  const transitions = await page.evaluate(expected => expected.map((phase, i) => {
    const begin = window.tunerCheck.startedAt + i * 2000;
    const match = window.tunerCheck.samples.find(r => r.time >= begin && r.time < begin + 2000 && (phase.frequency
      ? r.note === phase.note && r.octave === phase.octave && Number.isFinite(r.cents) && Math.abs(r.cents - phase.cents) < 2
      : ['-- Hz', '— Hz'].includes(r.frequency)));
    return { phase: i, approximateMs: match ? Math.round(match.time - begin) : null };
  }), phases);
  const layout = [];
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    layout.push(await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
      controls: [...document.querySelectorAll('#tuner-tool button')].map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })) })));
  }
  if (process.env.TUNER_SCREENSHOT) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: process.env.TUNER_SCREENSHOT, fullPage: true });
  }
  await page.locator('#tuner-stop').click();
  const stopped = await page.evaluate(() => ({ tracks: window.tunerCheck.streams.flatMap(s => s.getTracks().map(t => t.readyState)), contexts: window.tunerCheck.contexts.map(c => c.state) }));
  await page.locator('#tuner-start').click();
  await page.waitForFunction(() => window.tunerCheck.streams.length === 2);
  await page.locator('#tab-truco').click();
  await page.waitForTimeout(100);
  const navigated = await page.evaluate(() => ({ tracks: window.tunerCheck.streams.flatMap(s => s.getTracks().map(t => t.readyState)), state: document.querySelector('#tuner-tool').dataset.tunerState,
    contexts: window.tunerCheck.contexts.map(c => c.state), caches: null }));
  const cacheKeys = await page.evaluate(() => caches.keys());
  let interrupted;
  let denied;
  if (!baseline) {
    await page.locator('#tab-tuner').click();
    await page.locator('#tuner-start').click();
    await page.waitForFunction(() => window.tunerCheck.streams.length === 3);
    await page.evaluate(() => window.tunerCheck.contexts.at(-1).suspend());
    await page.waitForFunction(() => document.querySelector('#tuner-tool').dataset.tunerState === 'interrupted');
    interrupted = await page.evaluate(() => ({ tracks: window.tunerCheck.streams.flatMap(s => s.getTracks().map(t => t.readyState)), contexts: window.tunerCheck.contexts.map(c => c.state) }));
    await context.grantPermissions([], { origin: new URL(url).origin });
    await page.locator('#tuner-start').click();
    await page.waitForFunction(() => document.querySelector('#tuner-tool').dataset.tunerState === 'error');
    await page.waitForFunction(() => window.tunerCheck.contexts.every(c => c.state === 'closed'));
    denied = await page.locator('#tuner-status').textContent();
    await context.grantPermissions(['microphone'], { origin: new URL(url).origin });
    await page.locator('#tuner-start').click();
    await page.waitForFunction(() => window.tunerCheck.streams.length === 4);
    await page.locator('#tuner-stop').click();
  }
  const changes = await page.evaluate(() => {
    let last = '';
    return window.tunerCheck.samples.filter(r => {
      const key = `${r.state}/${r.note}/${r.octave}`;
      if (key === last) return false;
      last = key; return true;
    }).map(r => ({ ...r, relativeMs: Math.round(r.time - window.tunerCheck.startedAt) }));
  });
  console.log(JSON.stringify({ url, browser: browser.version(), syntheticMicrophone: true, results, transitions, layout, stopped, navigated, interrupted, denied, cacheKeys, errors,
    ...(process.env.TUNER_DEBUG ? { changes } : {}) }, null, 2));
  if (!baseline) {
    assert(results.every(r => r.matched), 'La captura sintética debe mostrar todas las notas, octavas y cents correctos');
    assert(layout.every(r => !r.overflow && r.controls.every(c => c.height >= 44 && c.width >= 44)), 'Diseño móvil sin desborde y controles táctiles');
    assert(stopped.tracks.every(s => s === 'ended') && stopped.contexts.every(s => s === 'closed'), 'Stop debe liberar micrófono y contexto');
    assert(navigated.tracks.every(s => s === 'ended') && navigated.contexts.every(s => s === 'closed'), 'Salir debe liberar micrófono y contexto');
    assert.equal(navigated.state, 'stopped');
    assert(interrupted.tracks.every(s => s === 'ended') && interrupted.contexts.every(s => s === 'closed'), 'Interrupción debe liberar micrófono y contexto');
    assert(denied.includes('denegado'), 'Permiso denegado debe mostrarse como error comprensible');
    assert.deepEqual(errors, []);
  }
} finally {
  await browser?.close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert(basename(directory).startsWith('budines-tuner-'));
  await rm(directory, { recursive: true, force: true });
}
