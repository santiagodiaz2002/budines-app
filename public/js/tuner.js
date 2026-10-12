import {
  A4_FREQUENCY,
  classifyCents,
  createPitchStabilizer,
  detectPitchYin,
  stopMediaStream
} from './tuner-core.js?v=tuner-20261012';

const ANALYSIS_INTERVAL_MS = 40;

export function initTuner(root = document.querySelector('#tuner-tool'), coordinator) {
  if (!root) return null;

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
  let activeSession = null;
  // Browsers cannot cancel an outstanding getUserMedia permission request.
  // Retain its ownership until it settles so restart cannot open a second one.
  let pendingCapture = null;
  const stabilizer = createPitchStabilizer();

  coordinator?.register('tuner', stop);
  dom.reference.textContent = `A4 = ${A4_FREQUENCY} Hz`;
  dom.start.addEventListener('click', start);
  dom.stop.addEventListener('click', stop);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') interrupt('El afinador se pausó al salir de la pantalla. Volvé a iniciar.');
  });
  window.addEventListener('pagehide', () => interrupt('El afinador se pausó al salir de la página. Volvé a iniciar.'));
  updateButtons();
  renderNoSignal('Micrófono detenido.', 'stopped');

  async function start() {
    if (activeSession || pendingCapture) return;
    if (!window.isSecureContext) {
      renderNoSignal('El afinador necesita HTTPS.', 'error');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      renderNoSignal('Este navegador no permite acceder al micrófono.', 'error');
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      renderNoSignal('Este navegador no soporta Web Audio API.', 'error');
      return;
    }

    const session = { timer: null, removers: [], detectionOptions: { workspace: {} }, listening: false };
    activeSession = session;
    stabilizer.reset();
    updateButtons();
    renderNoSignal('Esperando permiso de micrófono.', 'requesting');

    try {
      // Both calls run synchronously inside the button's gesture, before awaits.
      // Resume rejection is handled immediately even if the permission takes time.
      session.context = new AudioContextClass({ latencyHint: 'interactive' });
      const audioReady = Promise.resolve(session.context.resume()).then(
        () => ({ error: null }),
        (error) => {
          if (activeSession === session) endSession('El navegador no pudo reanudar el audio. Volvé a iniciar el afinador.', 'error');
          return { error };
        }
      );
      addSessionListener(session, session.context, 'statechange', () => {
        if (activeSession === session && session.listening && session.context.state !== 'running') {
          interrupt('El audio se interrumpió. Volvé a iniciar el afinador.');
        }
      });
      await coordinator?.requestStart('tuner');
      if (activeSession !== session) return;

      pendingCapture = session;
      const acquiredStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 1 }
        }
      });
      if (pendingCapture === session) pendingCapture = null;
      if (activeSession !== session) {
        stopMediaStream(acquiredStream);
        return;
      }
      session.stream = acquiredStream;
      for (const track of acquiredStream.getTracks()) {
        addSessionListener(session, track, 'ended', () => {
          if (activeSession === session) interrupt('El micrófono se desconectó. Volvé a iniciar el afinador.');
        });
        addSessionListener(session, track, 'mute', () => {
          if (activeSession === session) interrupt('El micrófono se interrumpió. Volvé a iniciar el afinador.');
        });
        if (track.readyState === 'ended') throw new Error('microphone_ended');
      }
      const ready = await audioReady;
      if (activeSession !== session) return;
      if (ready.error) throw ready.error;
      if (session.context.state !== 'running') throw new Error('audio_suspended');

      session.analyser = session.context.createAnalyser();
      // Keep at least 85 ms of samples even when a device selects 96/192 kHz.
      session.analyser.fftSize = Math.min(32768, 2 ** Math.ceil(Math.log2(session.context.sampleRate * 0.085)));
      session.analyser.smoothingTimeConstant = 0;
      session.source = session.context.createMediaStreamSource(acquiredStream);
      session.source.connect(session.analyser);
      // No destination connection: the microphone is analysed locally without playback.
      session.buffer = new Float32Array(session.analyser.fftSize);
      session.listening = true;
      updateButtons();
      renderNoSignal('Escuchando micrófono.', 'listening');
      tick(session);
    } catch (error) {
      if (activeSession !== session) return;
      endSession(formatMicrophoneError(error), 'error');
    } finally {
      if (pendingCapture === session) pendingCapture = null;
      updateButtons();
      if (!activeSession) renderNoSignal(dom.status.textContent, root.dataset.tunerState);
    }
  }

  function stop() {
    endSession('Micrófono detenido.', 'stopped');
  }

  function interrupt(message) {
    if (activeSession || pendingCapture) endSession(message, 'interrupted');
  }

  function endSession(message, state) {
    const session = activeSession;
    activeSession = null;
    if (session) {
      clearTimeout(session.timer);
      for (const remove of session.removers) remove();
      disconnect(session.source);
      disconnect(session.analyser);
      stopMediaStream(session.stream);
      try {
        Promise.resolve(session.context?.close?.()).catch(() => {});
      } catch {
        // A context already closed by the browser still needs the other cleanup.
      }
    }
    stabilizer.reset();
    updateButtons();
    renderNoSignal(message, state);
  }

  function addSessionListener(session, target, type, listener) {
    target.addEventListener?.(type, listener);
    session.removers.push(() => target.removeEventListener?.(type, listener));
  }

  function disconnect(node) {
    try { node?.disconnect?.(); } catch { /* Already disconnected. */ }
  }

  function updateButtons() {
    dom.start.disabled = Boolean(activeSession || pendingCapture);
    dom.stop.disabled = !activeSession;
  }

  function tick(session) {
    if (activeSession !== session || !session.listening) return;
    if (session.context.state !== 'running') {
      interrupt('El audio se interrumpió. Volvé a iniciar el afinador.');
      return;
    }
    try {
      session.analyser.getFloatTimeDomainData(session.buffer);
      const detection = detectPitchYin(session.buffer, session.context.sampleRate, session.detectionOptions);
      const stable = stabilizer.update(detection, performance.now());
      if (stable.stable && stable.note) {
        renderNote(stable.note);
      } else {
        renderNoSignal(stable.reason === 'insufficient_signal' ? 'Señal insuficiente.' : 'Señal inestable.', 'listening');
      }
      // Analysis runs at most 25 times/sec, independent of display refresh rate.
      session.timer = setTimeout(() => tick(session), ANALYSIS_INTERVAL_MS);
    } catch {
      endSession('Se interrumpió la lectura del micrófono. Volvé a iniciar.', 'error');
    }
  }

  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function renderNote(note) {
    const verdict = classifyCents(note.cents);
    const displayCents = Math.round(note.cents * 10) / 10;
    setText(dom.note, note.note);
    setText(dom.octave, String(note.octave));
    setText(dom.frequency, `${note.frequency.toFixed(1)} Hz`);
    setText(dom.target, `${note.targetFrequency.toFixed(1)} Hz`);
    setText(dom.cents, `${displayCents > 0 ? '+' : ''}${displayCents.toFixed(1)} cents`);
    setText(dom.verdict, verdict);
    setText(dom.status, 'Señal detectada.');
    dom.needle.style.setProperty('--cents', String(Math.max(-50, Math.min(50, note.cents))));
    root.dataset.tunerState = verdict === 'Afinado' ? 'in-tune' : 'signal';
    root.dataset.tunerDirection = verdict === 'Grave' ? 'low' : verdict === 'Agudo' ? 'high' : 'center';
    setText(dom.micState, 'Escuchando');
    setText(dom.guidance, verdict === 'Afinado' ? 'Afinación centrada (±5 cents).' : verdict === 'Grave' ? 'Subí la afinación.' : 'Bajá la afinación.');
  }

  function renderNoSignal(message, state) {
    const stopped = state === 'stopped';
    const error = state === 'error';
    const interrupted = state === 'interrupted';
    const requesting = state === 'requesting';
    setText(dom.note, '—');
    setText(dom.octave, '');
    setText(dom.frequency, '— Hz');
    setText(dom.target, '— Hz');
    setText(dom.cents, '— cents');
    setText(dom.verdict, stopped ? 'Detenido' : interrupted ? 'Pausado' : requesting ? 'Esperando permiso' : 'Sin señal');
    setText(dom.status, message);
    dom.needle.style.setProperty('--cents', '0');
    root.dataset.tunerState = state;
    root.dataset.tunerDirection = 'neutral';
    setText(dom.micState, stopped || interrupted ? 'Mic apagado' : error ? 'Revisar mic' : requesting ? 'Solicitando mic' : 'Escuchando');
    setText(dom.guidance, pendingCapture && !activeSession
      ? 'La solicitud de permiso sigue abierta. Cancelala o respondela en el navegador antes de volver a iniciar.'
      : stopped ? 'Iniciá el micrófono y tocá una nota.'
        : interrupted ? 'Iniciá otra vez cuando vuelvas a usar el afinador.'
          : error ? 'Revisá el permiso y volvé a intentar.'
            : requesting ? 'Aceptá el permiso para empezar a escuchar. Podés detener la solicitud.'
              : 'Tocá una nota sostenida y cerca del micrófono.');
  }

  function formatMicrophoneError(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Permiso de micrófono denegado. Habilitalo en el navegador y volvé a iniciar.';
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return 'No se encontró un micrófono disponible.';
    if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') return 'El micrófono está en uso o no se puede leer.';
    if (error?.name === 'OverconstrainedError') return 'El micrófono no admite la captura solicitada.';
    if (error?.name === 'AbortError') return 'El navegador interrumpió el inicio del micrófono. Volvé a intentar.';
    if (error?.message === 'audio_suspended') return 'El navegador pausó el audio. Volvé a iniciar el afinador.';
    if (error?.message === 'microphone_ended') return 'El micrófono se desconectó. Volvé a iniciar el afinador.';
    return 'No se pudo iniciar el micrófono. Revisá el permiso y volvé a intentar.';
  }

  return { stop };
}
