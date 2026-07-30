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
    reference: root.querySelector('#tuner-reference'),
    guidance: root.querySelector('#tuner-guidance'),
    micState: root.querySelector('#tuner-mic-state')
  };

  let context = null;
  let analyser = null;
  let source = null;
  let stream = null;
  let frame = null;
  let buffer = null;
  let isStarting = false;
  let startGeneration = 0;
  const stabilizer = createPitchStabilizer();

  coordinator?.register('tuner', stop);

  dom.reference.textContent = `A4 = ${A4_FREQUENCY} Hz`;
  dom.start.addEventListener('click', start);
  dom.stop.addEventListener('click', stop);
  renderNoSignal('Micrófono detenido.', 'stopped');

  async function start() {
    if (stream || isStarting) {
      return;
    }

    if (!window.isSecureContext) {
      renderNoSignal('El afinador necesita HTTPS.', 'error');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      renderNoSignal('No se encontró acceso al micrófono.', 'error');
      return;
    }

    const requestGeneration = ++startGeneration;
    isStarting = true;
    dom.start.disabled = true;
    root.dataset.tunerState = 'requesting';
    root.dataset.tunerDirection = 'neutral';
    dom.micState.textContent = 'Solicitando mic';
    dom.status.textContent = 'Esperando permiso de micrófono.';
    dom.guidance.textContent = 'Aceptá el permiso para empezar a escuchar.';

    try {
      await coordinator?.requestStart('tuner');
      if (requestGeneration !== startGeneration) {
        return;
      }

      const acquiredStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      if (requestGeneration !== startGeneration) {
        stopMediaStream(acquiredStream);
        return;
      }
      stream = acquiredStream;

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
      isStarting = false;
      dom.start.disabled = true;
      dom.stop.disabled = false;
      dom.status.textContent = 'Escuchando micrófono.';
      root.dataset.tunerState = 'listening';
      dom.micState.textContent = 'Escuchando';
      dom.guidance.textContent = 'Tocá una nota sostenida y cerca del micrófono.';
      tick();
    } catch (error) {
      if (requestGeneration !== startGeneration) {
        return;
      }
      stop();
      renderNoSignal(formatMicrophoneError(error), 'error');
    }
  }

  function stop() {
    startGeneration += 1;
    isStarting = false;
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
    renderNoSignal('Micrófono detenido.', 'stopped');
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
      renderNoSignal(stable.reason === 'insufficient_signal' ? 'Señal insuficiente.' : 'Señal inestable.', 'listening');
    }

    frame = requestAnimationFrame(tick);
  }

  function renderNote(note) {
    const verdict = classifyCents(note.cents);
    dom.note.textContent = note.note;
    dom.octave.textContent = String(note.octave);
    dom.frequency.textContent = `${note.frequency.toFixed(1)} Hz`;
    dom.target.textContent = `${note.targetFrequency.toFixed(1)} Hz`;
    dom.cents.textContent = `${note.cents > 0 ? '+' : ''}${note.cents.toFixed(1)} cents`;
    dom.verdict.textContent = verdict;
    dom.status.textContent = 'Señal detectada.';
    dom.needle.style.setProperty('--cents', String(Math.max(-50, Math.min(50, note.cents))));
    root.dataset.tunerState = verdict === 'Afinado' ? 'in-tune' : 'signal';
    root.dataset.tunerDirection = verdict === 'Grave' ? 'low' : verdict === 'Agudo' ? 'high' : 'center';
    dom.micState.textContent = 'Escuchando';
    dom.guidance.textContent =
      verdict === 'Afinado'
        ? 'Afinación centrada.'
        : verdict === 'Grave'
          ? 'Subí la afinación.'
          : 'Bajá la afinación.';
  }

  function renderNoSignal(message, state) {
    const fallback = frequencyToNote(A4_FREQUENCY);
    const stopped = state === 'stopped';
    const error = state === 'error';
    dom.note.textContent = fallback.note;
    dom.octave.textContent = String(fallback.octave);
    dom.frequency.textContent = '-- Hz';
    dom.target.textContent = `${A4_FREQUENCY.toFixed(1)} Hz`;
    dom.cents.textContent = '-- cents';
    dom.verdict.textContent = stopped ? 'Detenido' : 'Sin señal';
    dom.status.textContent = message;
    dom.needle.style.setProperty('--cents', '0');
    root.dataset.tunerState = state;
    root.dataset.tunerDirection = 'neutral';
    dom.micState.textContent = stopped ? 'Mic apagado' : error ? 'Revisar mic' : 'Escuchando';
    dom.guidance.textContent = stopped
      ? 'Iniciá el micrófono y tocá una nota.'
      : error
        ? 'Revisá el permiso y volvé a intentar.'
        : 'Tocá una nota sostenida y cerca del micrófono.';
  }

  function formatMicrophoneError(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return 'Permiso de micrófono denegado.';
    }
    if (error?.name === 'NotFoundError') {
      return 'No se encontró un micrófono disponible.';
    }
    if (error?.name === 'NotReadableError') {
      return 'El micrófono está en uso o no se puede leer.';
    }
    if (error?.message === 'Este navegador no soporta Web Audio API.') {
      return error.message;
    }
    return 'No se pudo iniciar el micrófono.';
  }

  return {
    stop
  };
}
