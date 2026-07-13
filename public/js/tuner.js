import {
  A4_FREQUENCY,
  classifyCents,
  createPitchStabilizer,
  detectPitchYin,
  frequencyToNote,
  stopMediaStream
} from './tuner-core.js';

export function initTuner(root = document.querySelector('#tuner-tool'), coordinator) {
  if (!root) {
    return null;
  }

  const dom = {
    start: root.querySelector('#tuner-start'),
    stop: root.querySelector('#tuner-stop'),
    status: root.querySelector('#tuner-status'),
    note: root.querySelector('#tuner-note'),
    octave: root.querySelector('#tuner-octave'),
    frequency: root.querySelector('#tuner-frequency'),
    target: root.querySelector('#tuner-target'),
    cents: root.querySelector('#tuner-cents'),
    verdict: root.querySelector('#tuner-verdict'),
    needle: root.querySelector('#tuner-needle'),
    reference: root.querySelector('#tuner-reference')
  };

  let context = null;
  let analyser = null;
  let source = null;
  let stream = null;
  let frame = null;
  let buffer = null;
  const stabilizer = createPitchStabilizer();

  coordinator?.register('tuner', stop);

  dom.reference.textContent = `A4 = ${A4_FREQUENCY} Hz`;
  dom.start.addEventListener('click', start);
  dom.stop.addEventListener('click', stop);
  renderNoSignal('Micrófono detenido.');

  async function start() {
    if (stream) {
      return;
    }

    if (!window.isSecureContext) {
      renderNoSignal('El afinador necesita HTTPS.');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      renderNoSignal('No se encontró acceso al micrófono.');
      return;
    }

    await coordinator?.requestStart('tuner');

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('Este navegador no soporta Web Audio API.');
      }

      context = new AudioContextClass();
      analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      buffer = new Float32Array(analyser.fftSize);
      stabilizer.reset();
      dom.start.disabled = true;
      dom.stop.disabled = false;
      dom.status.textContent = 'Escuchando micrófono.';
      tick();
    } catch (error) {
      stop();
      renderNoSignal(error?.name === 'NotAllowedError' ? 'Permiso de micrófono denegado.' : error.message || 'No se pudo iniciar el micrófono.');
    }
  }

  function stop() {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    source?.disconnect?.();
    analyser?.disconnect?.();
    stopMediaStream(stream);
    stream = null;
    source = null;
    analyser = null;
    buffer = null;
    stabilizer.reset();

    if (context) {
      context.close?.();
      context = null;
    }

    dom.start.disabled = false;
    dom.stop.disabled = true;
    renderNoSignal('Micrófono detenido.');
  }

  function tick() {
    if (!analyser || !buffer) {
      return;
    }

    analyser.getFloatTimeDomainData(buffer);
    const detection = detectPitchYin(buffer, context.sampleRate);
    const stable = stabilizer.update(detection);

    if (stable.stable && stable.note) {
      renderNote(stable.note);
    } else {
      renderNoSignal(stable.reason === 'insufficient_signal' ? 'Señal insuficiente.' : 'Señal inestable.');
    }

    frame = requestAnimationFrame(tick);
  }

  function renderNote(note) {
    dom.note.textContent = note.note;
    dom.octave.textContent = String(note.octave);
    dom.frequency.textContent = `${note.frequency.toFixed(1)} Hz`;
    dom.target.textContent = `${note.targetFrequency.toFixed(1)} Hz`;
    dom.cents.textContent = `${note.cents > 0 ? '+' : ''}${note.cents.toFixed(1)} cents`;
    dom.verdict.textContent = classifyCents(note.cents);
    dom.status.textContent = 'Señal detectada.';
    dom.needle.style.setProperty('--cents', String(Math.max(-50, Math.min(50, note.cents))));
  }

  function renderNoSignal(message) {
    const fallback = frequencyToNote(A4_FREQUENCY);
    dom.note.textContent = fallback.note;
    dom.octave.textContent = String(fallback.octave);
    dom.frequency.textContent = '-- Hz';
    dom.target.textContent = `${A4_FREQUENCY.toFixed(1)} Hz`;
    dom.cents.textContent = '-- cents';
    dom.verdict.textContent = message.includes('detenido') ? 'Detenido' : 'Sin señal';
    dom.status.textContent = message;
    dom.needle.style.setProperty('--cents', '0');
  }

  return {
    stop
  };
}
