import { createLocalDetector, loadModel } from './local-detector.js';
import { createPiPProbe, enterPiP, mayContinue, pipActive } from './pip-probe.js';

const get = id => document.getElementById(id);
const video = get('video');
let stream, controller, probe, pending = false, generation = 0, pipTimer, pipRequest = 0;
const launchMode = () => navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches
  ? 'home-screen' : 'browser';
const context = () => ({ hidden: document.hidden, pip: pipActive(video, document) });
const record = (type, detail = '') => probe?.record(type, { ...context(), detail });
const status = message => { get('status').textContent = message; };
const render = () => {
  if (!probe) return;
  let webkitPiPSupported = null;
  try { webkitPiPSupported = video.webkitSupportsPresentationMode?.('picture-in-picture') ?? null; } catch { /* Probe is optional. */ }
  const report = { browser: navigator.userAgent, launchMode: launchMode(), visibility: document.visibilityState,
    pipCapability: { standardEnabled: document.pictureInPictureEnabled ?? null,
      standardRequest: typeof video.requestPictureInPicture === 'function', webkitPiPSupported },
    videoReadyState: video.readyState,
    pipActive: pipActive(video, document), videoTime: video.currentTime,
    trackState: stream?.getVideoTracks()[0]?.readyState ?? 'none',
    trackMuted: stream?.getVideoTracks()[0]?.muted ?? null, ...probe.snapshot() };
  get('report').textContent = JSON.stringify(report, null, 2);
};

function speak(message, run) {
  if (!get('speech').checked || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'en-US';
  utterance.onend = () => { if (run === generation) { record('speech', message); render(); } };
  utterance.onerror = event => { if (run === generation) record('speech-error', event.error); };
  window.speechSynthesis.speak(utterance);
}

function stop(message = 'Stopped. Camera released.') {
  generation++;
  pipRequest++;
  clearTimeout(pipTimer);
  controller?.abort();
  controller = null;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
  window.speechSynthesis?.cancel();
  if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {});
  else if (video.webkitPresentationMode === 'picture-in-picture') {
    try { video.webkitSetPresentationMode('inline'); } catch { /* Camera is already released. */ }
  }
  get('start').disabled = pending;
  get('stop').disabled = true;
  get('pip').disabled = true;
  record('stop', message);
  status(message);
  render();
}

async function start() {
  if (pending || controller) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    status('Camera access requires localhost or trusted HTTPS.'); return;
  }
  pending = true;
  const run = ++generation;
  probe = createPiPProbe();
  get('start').disabled = true;
  get('stop').disabled = false;
  status('Requesting camera permission.');
  speak('PiP test started. Obstacle speech enabled.', run);
  try {
    const requested = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 } } });
    if (run !== generation) { requested.getTracks().forEach(track => track.stop()); return; }
    stream = requested;
    const track = stream.getVideoTracks()[0];
    for (const type of ['mute', 'unmute', 'ended']) track.addEventListener(type, () => {
      if (run !== generation) return;
      record(`track-${type}`); render();
      if (type === 'ended') stop('Camera track ended.');
    });
    video.srcObject = stream;
    await video.play();
    if (run !== generation) return;
    controller = new AbortController();
    const signal = controller.signal;
    const detector = createLocalDetector({ loader: async ({ onStatus }) => {
      const model = await loadModel({ onStatus });
      return { detect: async (...args) => {
        if (!probe.acceptInput({ currentTime: video.currentTime, readyState: video.readyState,
          muted: track.muted, trackState: track.readyState, ...context() })) {
          throw new Error('No advancing camera frame available.');
        }
        return model.detect(...args);
      } };
    } });
    await detector.start({ video, signal,
      onStatus: message => { if (run === generation) status(message); },
      onResult: result => {
        if (run !== generation || !mayContinue(document.hidden, pipActive(video, document))) return;
        record('result', result.detections.map(item => item.label).join(', ') || 'No supported objects');
        status(`Detection running. ${result.detections.length} supported objects in last frame.`);
        render();
      },
      onObstacle: () => {
        if (run !== generation || !mayContinue(document.hidden, pipActive(video, document))) return;
        record('obstacle'); speak('Object ahead.', run); render();
      },
      onError: error => {
        if (run !== generation) return;
        const message = error?.message || String(error);
        record('detector-error', message); status(message); render();
      },
    });
    if (run !== generation) return;
    get('pip').disabled = false;
    render();
  } catch (error) {
    if (run === generation) stop(`Could not start: ${error.message}`);
  } finally {
    pending = false;
    if (!controller) get('start').disabled = false;
  }
}

get('start').addEventListener('click', () => void start());
get('stop').addEventListener('click', () => stop());
get('pip').addEventListener('click', () => {
  const request = ++pipRequest, run = generation;
  clearTimeout(pipTimer);
  status('Opening PiP. Wait for an actual floating camera window before switching apps.');
  pipTimer = setTimeout(() => {
    if (request !== pipRequest || run !== generation) return;
    if (pipActive(video, document)) {
      record('pip-confirmed');
      status('PiP active. Switch apps and test a new object.');
    } else {
      pipRequest++;
      const message = launchMode() === 'home-screen'
        ? 'PiP did not open in this Home Screen app. Try the same test URL directly in Safari. A successful API call does not guarantee a floating window.'
        : 'PiP did not open. This browser may not support PiP for this camera video. Stay here and inspect the report.';
      record('pip-not-open', message); status(message);
    }
    render();
  }, 3000);
  void enterPiP(video, document).then(() => {
    if (request !== pipRequest || run !== generation) return;
    record('pip-request');
    if (pipActive(video, document)) {
      clearTimeout(pipTimer); record('pip-confirmed');
      status('PiP active. Switch apps and test a new object.');
    }
    render();
  }).catch(error => {
    if (request !== pipRequest || run !== generation) return;
    clearTimeout(pipTimer); pipRequest++;
    const message = error.message + (launchMode() === 'home-screen' ? ' Try the same test URL directly in Safari.' : '');
    record('pip-error', message); status(message); render();
  });
});
get('speech').addEventListener('change', () => {
  if (!get('speech').checked) window.speechSynthesis?.cancel();
});
document.addEventListener('visibilitychange', () => {
  record('visibility'); render();
  if (!mayContinue(document.hidden, pipActive(video, document))) stop('Stopped because the page was hidden without active PiP.');
});
for (const type of ['enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged']) {
  video.addEventListener(type, () => {
    record(type); render();
    if (document.hidden && !pipActive(video, document)) stop('Stopped because the floating window closed while hidden.');
  });
}
window.addEventListener('pagehide', () => stop('Stopped because the page was closed or navigated away.'));
get('download').addEventListener('click', () => {
  render();
  const url = URL.createObjectURL(new Blob([get('report').textContent], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'clarity-pip-test.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
