import { notifyPhone } from './phone-notifications.js';
import { containRect, captureSize } from './logic.js';

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries(['camera-stage', 'camera', 'overlay', 'demo-scene', 'demo-tab', 'live-tab', 'source-badge', 'feed-label', 'feed-counter', 'feed-caption', 'stage-prompt', 'status-orb', 'status-title', 'status-detail', 'status-word', 'start-button', 'start-label', 'start-icon', 'test-alert', 'demo-controls', 'add-obstacle', 'move-obstacle', 'remove-obstacle', 'preferences', 'standard-preset', 'accessible-preset', 'sound-mode', 'speech-mode', 'vibration-mode', 'vibration-note', 'speech-note', 'settings-hint', 'activity-live', 'frame-count', 'frame-metric-label', 'latency', 'activity-log', 'how-dialog', 'toast'].map((id) => [id, $(id)]));
const DEMO_ZONE = [{ x: .38, y: .42 }, { x: .62, y: .42 }, { x: .95, y: 1 }, { x: .05, y: 1 }];
const state = { mode: 'demo', phase: 'idle', generation: 0, timer: null, controller: null, stream: null, session: null, sequence: 0, frames: 0, detections: [], zone: DEMO_ZONE, preset: 'standard', obstacle: 'none', demoSeen: 0, lastDemoAlert: -Infinity, events: [], audio: null, oscillators: new Set(), toastTimer: null, lastResultAt: 0, captureMaxSide: 640, latencySamples: [], lastFrameTime: -1, lastFrameAt: 0, stallStrikes: 0 };
const frameCanvas = document.createElement('canvas');
const context = ui.overlay.getContext('2d');
const supports = { sound: Boolean(window.AudioContext || window.webkitAudioContext), speech: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window, vibration: typeof navigator.vibrate === 'function' };

function selectedModes() { return ['sound', 'speech', 'vibration'].filter((mode) => ui[`${mode}-mode`].checked && supports[mode]); }
function active() { return ['starting', 'running'].includes(state.phase); }
function setStatus(title, detail, word = 'IDLE', appearance = '') {
  ui['status-title'].textContent = title;
  ui['status-detail'].textContent = detail;
  ui['status-word'].textContent = word;
  ui['status-orb'].className = `status-orb ${appearance}`;
}
function toast(message) {
  clearTimeout(state.toastTimer);
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  state.toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 4500);
}
function log(title, detail = '') {
  state.events.unshift({ title, detail });
  state.events = state.events.slice(0, 3);
  ui['activity-log'].replaceChildren(...state.events.map((item) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    const content = document.createElement('div');
    content.textContent = item.title;
    if (item.detail) { const small = document.createElement('small'); small.textContent = item.detail; content.append(small); }
    li.append(dot, content);
    return li;
  }));
}
function flow(step = '') { document.querySelectorAll('[data-step]').forEach((element) => element.classList.toggle('current', element.dataset.step === step)); }
function renderControls() {
  const running = active();
  ui['start-label'].textContent = running ? (state.phase === 'starting' ? 'Cancel' : 'Stop scanning') : state.mode === 'demo' ? 'Start walkthrough' : 'Start camera scan';
  ui['start-icon'].textContent = running ? '□' : '▷';
  ui['start-button'].classList.toggle('stop', running);
  ui.preferences.disabled = running;
  ui['settings-hint'].textContent = running ? 'Stop scanning to change your preferences.' : 'You can combine alert types. Visual alerts are always shown.';
  ui['demo-tab'].classList.toggle('active', state.mode === 'demo');
  ui['demo-tab'].setAttribute('aria-pressed', String(state.mode === 'demo'));
  ui['live-tab'].classList.toggle('active', state.mode === 'live');
  ui['live-tab'].setAttribute('aria-pressed', String(state.mode === 'live'));
  ui['source-badge'].textContent = state.mode === 'demo' ? 'SIMULATED' : 'LIVE CAMERA';
  ui['source-badge'].classList.toggle('live', state.mode === 'live');
  ui['demo-scene'].hidden = state.mode !== 'demo';
  ui.camera.hidden = state.mode !== 'live';
  ui['demo-controls'].hidden = state.mode !== 'demo';
  ui['add-obstacle'].disabled = !running || state.mode !== 'demo' || state.obstacle === 'center';
  ui['move-obstacle'].disabled = !running || state.mode !== 'demo' || state.obstacle === 'none' || state.obstacle === 'edge';
  ui['remove-obstacle'].disabled = !running || state.mode !== 'demo' || state.obstacle === 'none';
  ui['stage-prompt'].hidden = running && state.phase !== 'starting';
  ui['stage-prompt'].querySelector('strong').textContent = state.mode === 'demo' ? 'A second look, before your next step.' : 'Your camera. A fresh perspective.';
  ui['stage-prompt'].querySelector('span:last-child').textContent = state.mode === 'demo' ? 'Start the walkthrough to see how an alert happens.' : 'Start scanning and point the camera at a supported object.';
  ui['feed-label'].replaceChildren();
  ui['feed-label'].append(document.createElement('span'), document.createTextNode(state.mode === 'demo' ? ' GUIDED DEMO' : ' CAMERA PREVIEW'));
  ui['feed-caption'].textContent = state.mode === 'demo' ? 'Simulated camera & detections' : 'Frames analyzed by your backend';
  ui['frame-metric-label'].textContent = state.mode === 'demo' ? 'Demo observations' : 'Frames analyzed';
  ui['activity-live'].textContent = state.phase === 'running' ? (state.mode === 'demo' ? 'SIMULATED' : 'LIVE') : 'STANDBY';
}
function resetMetrics() {
  state.frames = 0;
  state.captureMaxSide = 640;
  state.latencySamples = [];
  state.lastFrameTime = -1;
  state.lastFrameAt = performance.now();
  state.stallStrikes = 0;
  state.sequence = 0;
  state.lastResultAt = 0;
  ui['frame-count'].textContent = '0';
  ui['feed-counter'].textContent = '0000';
  ui.latency.textContent = '—';
}
function setPreset(preset) {
  state.preset = preset;
  ui['sound-mode'].checked = preset === 'standard' && supports.sound;
  ui['speech-mode'].checked = preset === 'accessibility' && supports.speech;
  if (preset === 'accessibility' && !supports.speech) ui['sound-mode'].checked = supports.sound;
  ui['standard-preset'].classList.toggle('selected', preset === 'standard');
  ui['accessible-preset'].classList.toggle('selected', preset === 'accessibility');
  ui['standard-preset'].setAttribute('aria-pressed', String(preset === 'standard'));
  ui['accessible-preset'].setAttribute('aria-pressed', String(preset === 'accessibility'));
}

async function primeAudio() {
  if (!supports.sound) return;
  try {
    if (!state.audio) { const Audio = window.AudioContext || window.webkitAudioContext; state.audio = new Audio(); }
    await state.audio.resume();
  } catch { /* Visual alerts remain available if this browser refuses audio. */ }
}
function stopAlerts() {
  for (const oscillator of state.oscillators) { try { oscillator.stop(); } catch { /* Already ended. */ } }
  state.oscillators.clear();
  if (supports.speech) window.speechSynthesis.cancel();
  if (supports.vibration) navigator.vibrate(0);
}
function playTonePreset(preset) {
  if (!state.audio || state.audio.state !== 'running') return false;

  const tones = {
    ping: [{ frequency: 880, start: 0, duration: .18, type: 'sine' }],
    double: [
      { frequency: 660, start: 0, duration: .13, type: 'square' },
      { frequency: 660, start: .23, duration: .13, type: 'square' }
    ],
    rising: [
      { frequency: 520, start: 0, duration: .16, type: 'sine' },
      { frequency: 740, start: .14, duration: .18, type: 'sine' },
      { frequency: 1040, start: .3, duration: .24, type: 'sine' }
    ],
    pulse: [
      { frequency: 440, start: 0, duration: .2, type: 'triangle' },
      { frequency: 360, start: .27, duration: .2, type: 'triangle' }
    ],
    soft: [
      { frequency: 587, start: 0, duration: .22, type: 'sine' },
      { frequency: 784, start: .17, duration: .3, type: 'sine' }
    ]
  };

  const schedule = tones[preset] || tones.ping;
  const now = state.audio.currentTime;

  schedule.forEach(({ frequency, start, duration, type }) => {
    const oscillator = state.audio.createOscillator();
    const gain = state.audio.createGain();
    const begins = now + start;

    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.001, begins);
    gain.gain.linearRampToValueAtTime(.12, begins + .015);
    gain.gain.exponentialRampToValueAtTime(.001, begins + duration);
    oscillator.connect(gain).connect(state.audio.destination);
    oscillator.start(begins);
    oscillator.stop(begins + duration + .02);
    state.oscillators.add(oscillator);
    oscillator.onended = () => {
      state.oscillators.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
  });

  return true;
}

function readStoredCustomSound() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Custom sound storage is unavailable.'));
      return;
    }

    const request = indexedDB.open('clearpath-audio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sounds');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const getRequest = database
        .transaction('sounds', 'readonly')
        .objectStore('sounds')
        .get('custom-alert');
      getRequest.onsuccess = () => resolve(getRequest.result || null);
      getRequest.onerror = () => reject(getRequest.error);
    };
  });
}

async function playCustomSound() {
  if (!state.audio || state.audio.state !== 'running') return false;

  const file = await readStoredCustomSound();
  if (!file) return false;

  const buffer = await state.audio.decodeAudioData(await file.arrayBuffer());
  const source = state.audio.createBufferSource();
  source.buffer = buffer;
  source.connect(state.audio.destination);
  source.start();
  state.oscillators.add(source);
  source.onended = () => {
    state.oscillators.delete(source);
    source.disconnect();
  };
  return true;
}

async function playSelectedAlertSound() {
  const selected = localStorage.getItem('clearpath-alert-sound') || 'ping';

  if (selected === 'custom') {
    try {
      if (await playCustomSound()) return true;
    } catch { /* Fall back to a built-in cue if the custom file cannot be read. */ }
    return playTonePreset('ping');
  }

  return playTonePreset(selected);
}

function notify(message, modes = selectedModes()) {
  void notifyPhone(message);
  let delivered = 0;
  if (modes.includes('sound') && state.audio?.state === 'running') {
    playSelectedAlertSound().catch(() => playTonePreset('ping'));
    delivered += 1;
  }
  if (modes.includes('speech') && supports.speech) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 1;
    utterance.onerror = () => toast('Voice could not play. The visual alert is still shown.');
    window.speechSynthesis.speak(utterance);
    delivered += 1;
  }
  if (modes.includes('vibration') && supports.vibration && navigator.vibrate([180, 80, 180])) delivered += 1;
  toast(message + (modes.length && delivered === 0 ? ' Check your device’s alert support and volume.' : ''));
}
async function api(path, options = {}, signal = state.controller?.signal) {
  const response = await fetch(path, { ...options, signal, cache: 'no-store' });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(data?.error?.message || (path === '/ready' ? 'The detector is still loading. Wait a moment and try again.' : `The backend returned ${response.status}.`));
    error.status = response.status;
    error.code = data?.error?.code;
    throw error;
  }
  return data;
}
function deleteSession(id) {
  if (id) fetch(`/api/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}
function stop(message = 'Scan stopped', detail = 'Your camera is off. Start again whenever you’re ready.', paused = false) {
  state.generation += 1;
  state.phase = paused ? 'paused' : 'idle';
  clearTimeout(state.timer);
  state.timer = null;
  state.controller?.abort();
  state.controller = null;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  ui.camera.srcObject = null;
  deleteSession(state.session);
  state.session = null;
  state.detections = [];
  state.obstacle = 'none';
  state.demoSeen = 0;
  stopAlerts();
  clearTimeout(state.toastTimer);
  ui.toast.hidden = true;
  setStatus(message, detail, paused ? 'PAUSED' : 'IDLE');
  flow();
  renderControls();
  draw();
}
async function changeMode(mode) {
  if (mode === state.mode) return;
  stop();
  state.mode = mode;
  state.events = [];
  state.zone = DEMO_ZONE;
  resetMetrics();
  setStatus(mode === 'demo' ? 'Ready when you are' : 'Camera is off', mode === 'demo' ? 'No camera permission needed for the walkthrough.' : 'Frames are sent to your backend for analysis without being saved.');
  log(mode === 'demo' ? 'Walkthrough selected' : 'Live camera selected', mode === 'demo' ? 'This mode uses simulated camera observations.' : 'Start your backend, then grant camera access.');
  renderControls();
  draw();
}

function demoTick(generation) {
  if (generation !== state.generation || state.phase !== 'running') return;
  state.frames += 1;
  const inside = state.obstacle === 'center';
  const box = inside ? { x: .43, y: .47, width: .18, height: .33 } : { x: .82, y: .30, width: .12, height: .22 };
  state.detections = state.obstacle === 'none' ? [] : [{ label: 'backpack', confidence: .91, bbox: box, inZone: inside }];
  if (inside) {
    state.demoSeen += 1;
    if (state.demoSeen < 2) {
      setStatus('One observation. Checking again…', 'Simulated backpack found inside the marked image zone.', 'CONFIRM', 'active');
      flow('confirm');
    } else if (performance.now() - state.lastDemoAlert >= 3000) {
      state.lastDemoAlert = performance.now();
      setStatus('Heads-up: object in the zone', 'Simulated alert · Two observations confirmed the backpack.', 'ALERT', 'warning');
      flow('alert');
      log('Demo alert triggered', 'Two matching observations → your selected notifications.');
      notify('Demo: backpack in the camera zone. Check your surroundings.');
    }
  } else {
    state.demoSeen = 0;
    setStatus(state.obstacle === 'edge' ? 'Object outside the marked zone' : 'Watching for a supported object', state.obstacle === 'edge' ? 'The simulated backpack is visible; its anchor is outside the zone.' : 'Add a backpack below to see confirmation and an alert.', 'DEMO', 'active');
    flow(state.obstacle === 'edge' ? 'detect' : 'capture');
  }
  updateMetrics();
  draw();
  state.timer = setTimeout(() => demoTick(generation), 650);
}

async function start() {
  if (active()) { stop(); log('Scanning stopped', 'Camera and uploads are stopped.'); return; }
  const generation = ++state.generation;
  state.phase = 'starting';
  state.controller = new AbortController();
  resetMetrics();
  state.detections = [];
  state.obstacle = 'none';
  state.demoSeen = 0;
  state.lastDemoAlert = -Infinity;
  renderControls();
  void primeAudio();
  if (state.mode === 'demo') {
    state.phase = 'running';
    state.zone = DEMO_ZONE;
    log('Walkthrough started', 'Illustrated camera and simulated detections.');
    renderControls();
    demoTick(generation);
    return;
  }
  setStatus('Connecting your camera…', 'Grant camera access, then we’ll check your detection backend.', 'STARTING', 'active');
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs localhost or trusted HTTPS. Open this demo on your Mac at http://localhost:5180.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } } });
    if (generation !== state.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
    state.stream = stream;
    ui.camera.srcObject = stream;
    await ui.camera.play();
    if (generation !== state.generation) return;
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (generation === state.generation && active()) { stop('Camera interrupted', 'Start again after the camera becomes available.', true); log('Camera interrupted'); } });
    setStatus('Checking the detector…', 'The first backend startup downloads the model weights.', 'LOADING', 'active');
    await api('/ready');
    const model = await api('/api/v1/model');
    if (generation !== state.generation) return;
    state.zone = model.zone;
    const session = await api('/api/v1/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: state.preset, preferences: { alertModes: selectedModes(), confidenceThreshold: .6, cooldownMs: 3000 } }) });
    if (generation !== state.generation) { deleteSession(session.sessionId); return; }
    state.session = session.sessionId;
    state.phase = 'running';
    log('Live camera connected', 'Real frames → backend COCO-SSD → alert decisions.');
    setStatus('Watching for supported objects', 'Point the camera at a backpack, chair, suitcase, or person.', 'LIVE', 'active');
    renderControls();
    void liveTick(generation);
  } catch (error) {
    if (generation !== state.generation || error.name === 'AbortError') return;
    const message = error.name === 'NotAllowedError' ? 'Camera permission was not granted. Allow access in your browser and try again.' : error.name === 'NotFoundError' ? 'No camera was found. Try the walkthrough or use a device with a camera.' : error.name === 'NotReadableError' ? 'Your camera is busy. Close the app using it and try again.' : error.message;
    stop('Couldn’t start scanning', message);
    log('Start needs attention', message);
    toast(message);
  }
}

function captureFrame() {
  const size = captureSize(ui.camera.videoWidth, ui.camera.videoHeight, state.captureMaxSide);
  frameCanvas.width = size.width;
  frameCanvas.height = size.height;
  frameCanvas.getContext('2d').drawImage(ui.camera, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => frameCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('This camera frame could not be encoded.')), 'image/jpeg', .75));
}
async function liveTick(generation) {
  if (generation !== state.generation || state.phase !== 'running') return;
  const started = performance.now();
  // Pace from measured round-trip time instead of a fixed interval.
  let nextDelay = 120;
  try {
    flow('capture');
    if (!previewAdvancing()) {
      setStatus('Camera preview stalled', 'The preview stopped updating. Recovering the camera…', 'WAITING');
      try { await ui.camera.play(); } catch { /* Stop and Start remains available. */ }
      if (state.stallStrikes > 3) { stop('Camera preview froze', 'The preview stopped updating and could not recover. Start again.', true); log('Camera preview froze'); return; }
      state.timer = setTimeout(() => liveTick(generation), 500);
      return;
    }
    const blob = await captureFrame();
    if (generation !== state.generation) return;
    flow('detect');
    state.sequence += 1;
    const result = await api(`/api/v1/sessions/${encodeURIComponent(state.session)}/frames`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Frame-Sequence': String(state.sequence) }, body: blob });
    if (generation !== state.generation) return;
    state.frames += 1;
    const ageMs = performance.now() - started;
    state.detections = ageMs <= 2500 ? result.detections : [];
    state.lastResultAt = performance.now();
    ui.latency.textContent = `${Math.round(ageMs)}ms`;
    adaptCaptureSize(ageMs);
    updateMetrics();
    if (ageMs > 2500) {
      setStatus('Late result skipped', 'Capturing a fresh frame. No alert was played from the delayed result.', 'WAITING');
      flow('capture');
    } else if (result.alert.triggered) {
      setStatus('Heads-up: object in the zone', result.alert.message, 'ALERT', 'warning');
      flow('alert');
      log('Object alert triggered', result.detections.filter((item) => item.inZone).map((item) => item.label).join(', ') || 'Confirmed object in the marked image zone.');
      notify(result.alert.message, result.alert.modalities);
    } else if (result.alert.reason === 'confirming') {
      setStatus('Object seen. Checking another frame…', 'An observation inside the marked zone needs confirmation.', 'CONFIRM', 'active');
      flow('confirm');
    } else if (result.alert.reason === 'cooldown') {
      setStatus('Object remains in the marked zone', `Another alert is available in ${Math.ceil(result.alert.cooldownRemainingMs / 1000)}s.`, 'WATCHING', 'warning');
      flow('confirm');
    } else {
      setStatus('Watching for supported objects', `${result.detections.length} object${result.detections.length === 1 ? '' : 's'} detected · No confirmed alert this frame.`, 'LIVE', 'active');
      flow('detect');
    }
    draw();
  } catch (error) {
    if (generation !== state.generation || error.name === 'AbortError') return;
    state.detections = [];
    draw();
    if (error.status === 429 || error.status === 409) {
      nextDelay = 1100;
      setStatus('Waiting for a fresh frame', error.status === 429 ? 'The shared detector is busy. Retrying shortly.' : 'The frame was superseded. Capturing a fresh image.', 'WAITING');
    } else {
      stop('Detection paused', error.status === 404 ? 'This session ended. Start again to create a new one.' : error.message || 'Backend connection lost. Check the API and try again.', true);
      log('Detection paused', 'No old detections are shown. Start again when ready.');
      return;
    }
  }
  if (generation === state.generation && state.phase === 'running') state.timer = setTimeout(() => liveTick(generation), Math.max(60, nextDelay - (performance.now() - started)));
}

// A frozen preview must not be analyzed as if it were a fresh view of the path.
function previewAdvancing() {
  const currentTime = Number(ui.camera.currentTime) || 0;
  if (currentTime !== state.lastFrameTime) {
    state.lastFrameTime = currentTime;
    state.lastFrameAt = performance.now();
    state.stallStrikes = 0;
    return true;
  }
  if (performance.now() - state.lastFrameAt < 4000) return true;
  state.stallStrikes += 1;
  state.lastFrameAt = performance.now();
  return false;
}
// Slow devices and slow links get smaller frames rather than a growing backlog.
const CAPTURE_SIZES = [640, 512, 384];
function adaptCaptureSize(ageMs) {
  state.latencySamples.push(ageMs);
  if (state.latencySamples.length > 10) state.latencySamples.shift();
  if (state.latencySamples.length < 3) return;
  const average = state.latencySamples.reduce((total, value) => total + value, 0) / state.latencySamples.length;
  const index = CAPTURE_SIZES.indexOf(state.captureMaxSide);
  if (average > 700 && index < CAPTURE_SIZES.length - 1) { state.captureMaxSide = CAPTURE_SIZES[index + 1]; state.latencySamples = []; }
  else if (average < 280 && index > 0) { state.captureMaxSide = CAPTURE_SIZES[index - 1]; state.latencySamples = []; }
}
function updateMetrics() {
  ui['frame-count'].textContent = String(state.frames);
  ui['feed-counter'].textContent = String(state.frames).padStart(4, '0');
}
function roundedBox(x, y, width, height, radius = 6) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}
function drawDemoBag(box, fit) {
  const x = fit.x + box.x * fit.width, y = fit.y + box.y * fit.height, w = box.width * fit.width, h = box.height * fit.height;
  context.save();
  context.fillStyle = '#10231877';
  context.beginPath(); context.ellipse(x + w * .5, y + h * .98, w * .7, h * .1, 0, 0, Math.PI * 2); context.fill();
  context.strokeStyle = '#c1a476'; context.lineWidth = Math.max(3, w * .09);
  context.beginPath(); context.ellipse(x + w * .5, y + h * .14, w * .18, h * .13, 0, Math.PI, Math.PI * 2); context.stroke();
  context.fillStyle = '#96815b'; roundedBox(x + w * .03, y + h * .14, w * .94, h * .83, Math.max(4, w * .17)); context.fill();
  context.fillStyle = '#bda679'; roundedBox(x + w * .08, y + h * .05, w * .84, h * .76, Math.max(4, w * .21)); context.fill();
  context.fillStyle = '#867650'; roundedBox(x + w * .2, y + h * .49, w * .6, h * .32, Math.max(3, w * .08)); context.fill();
  context.strokeStyle = '#e0c796'; context.lineWidth = Math.max(1, w * .025); context.beginPath(); context.moveTo(x + w * .24, y + h * .55); context.lineTo(x + w * .76, y + h * .55); context.stroke();
  context.fillStyle = '#eee2bd'; roundedBox(x + w * .41, y + h * .3, w * .18, h * .1, 2); context.fill();
  context.restore();
}
function draw() {
  const bounds = ui['camera-stage'].getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  ui.overlay.width = Math.round(bounds.width * ratio);
  ui.overlay.height = Math.round(bounds.height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  if (state.phase !== 'running') return;
  const fit = containRect(bounds.width, bounds.height, state.mode === 'demo' ? 960 : ui.camera.videoWidth, state.mode === 'demo' ? 720 : ui.camera.videoHeight);
  if (!fit) return;
  if (state.mode === 'demo' && state.detections[0]) drawDemoBag(state.detections[0].bbox, fit);
  context.beginPath();
  state.zone.forEach((point, index) => { context[index ? 'lineTo' : 'moveTo'](fit.x + point.x * fit.width, fit.y + point.y * fit.height); });
  context.closePath(); context.fillStyle = '#c6ee9110'; context.fill(); context.strokeStyle = '#c6ee9188'; context.lineWidth = 1; context.setLineDash([6, 6]); context.stroke(); context.setLineDash([]);
  if (state.mode === 'live' && performance.now() - state.lastResultAt > 2500) return;
  for (const detection of state.detections) {
    const box = detection.bbox;
    const x = fit.x + box.x * fit.width, y = fit.y + box.y * fit.height, width = box.width * fit.width, height = box.height * fit.height;
    context.strokeStyle = detection.inZone ? '#f5d39f' : '#c6ee91'; context.lineWidth = 1.5;
    roundedBox(x, y, width, height); context.stroke();
    const label = `${detection.label.toUpperCase()} ${Math.round(detection.confidence * 100)}%${state.mode === 'demo' ? ' · DEMO' : ''}`;
    context.font = '500 9px -apple-system, BlinkMacSystemFont, sans-serif';
    const labelWidth = context.measureText(label).width + 14;
    const labelX = Math.max(fit.x, Math.min(x, fit.x + fit.width - labelWidth));
    const labelY = Math.max(fit.y + 4, y - 25);
    context.fillStyle = detection.inZone ? '#f5d39f' : '#c6ee91'; roundedBox(labelX, labelY, labelWidth, 20, 4); context.fill();
    context.fillStyle = '#203021'; context.fillText(label, labelX + 7, labelY + 13);
    context.beginPath(); context.arc(x + width / 2, y + height, 3.5, 0, Math.PI * 2); context.fillStyle = detection.inZone ? '#f5d39f' : '#c6ee91'; context.fill();
  }
}

ui['demo-tab'].addEventListener('click', () => changeMode('demo'));
ui['live-tab'].addEventListener('click', () => changeMode('live'));
ui['start-button'].addEventListener('click', start);
ui['test-alert'].addEventListener('click', async () => { await primeAudio(); notify('Test alert. Check your surroundings.'); log('Test alert requested', selectedModes().join(' + ') || 'Visual feedback only.'); });
const soundSelect = $('alert-sound-select');
const customSoundInput = $('custom-alert-sound');
const customSoundRow = $('custom-alert-sound-row');
const customSoundName = $('custom-alert-sound-name');
const previewSoundButton = $('preview-alert-sound');
let selectedCustomSound = null;

function updateCustomSoundRow() {
  customSoundRow.hidden = soundSelect.value !== 'custom';
}

soundSelect.value = localStorage.getItem('clearpath-alert-sound') || 'ping';
updateCustomSoundRow();
soundSelect.addEventListener('change', () => {
  localStorage.setItem('clearpath-alert-sound', soundSelect.value);
  updateCustomSoundRow();
});

customSoundInput.addEventListener('change', async () => {
  const file = customSoundInput.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('audio/') || file.size > 10 * 1024 * 1024) {
    toast('Choose an audio file smaller than 10 MB.');
    customSoundInput.value = '';
    return;
  }

  selectedCustomSound = file;
  soundSelect.value = 'custom';
  localStorage.setItem('clearpath-alert-sound', 'custom');
  updateCustomSoundRow();
  customSoundName.textContent = file.name;

  try {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('clearpath-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sounds');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('sounds', 'readwrite');
      transaction.objectStore('sounds').put(file, 'custom-alert');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    toast('Custom alert sound saved on this device.');
  } catch {
    toast('Custom sound is ready for this session.');
  }
});

previewSoundButton.addEventListener('click', async () => {
  await primeAudio();

  if (soundSelect.value === 'custom' && selectedCustomSound) {
    try {
      const buffer = await state.audio.decodeAudioData(
        await selectedCustomSound.arrayBuffer()
      );
      const source = state.audio.createBufferSource();
      source.buffer = buffer;
      source.connect(state.audio.destination);
      source.start();
      return;
    } catch {
      toast('Could not play the selected sound.');
      return;
    }
  }

  const previewed = await playSelectedAlertSound();
  if (!previewed) toast('Choose an audio file before previewing your custom sound.');
});

ui['standard-preset'].addEventListener('click', () => setPreset('standard'));
ui['accessible-preset'].addEventListener('click', () => setPreset('accessibility'));
ui['add-obstacle'].addEventListener('click', () => { state.obstacle = 'center'; state.demoSeen = 0; state.lastDemoAlert = -Infinity; log('Demo backpack placed in the zone', 'Watch for a second observation before the alert.'); renderControls(); });
ui['move-obstacle'].addEventListener('click', () => { state.obstacle = 'edge'; state.demoSeen = 0; log('Demo backpack moved to the edge', 'A visible object does not always trigger an alert.'); renderControls(); });
ui['remove-obstacle'].addEventListener('click', () => { state.obstacle = 'none'; state.demoSeen = 0; state.detections = []; log('Demo backpack removed', 'The scanner keeps looking for supported objects.'); renderControls(); draw(); });
$('how-button').addEventListener('click', () => ui['how-dialog'].showModal());
$('close-dialog').addEventListener('click', () => ui['how-dialog'].close());
$('understood-button').addEventListener('click', () => ui['how-dialog'].close());
ui['how-dialog'].addEventListener('click', (event) => { if (event.target === ui['how-dialog']) { const bounds = ui['how-dialog'].getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) ui['how-dialog'].close(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden && active()) { stop('Paused when you left the page', 'Keep this page visible, then tap Start to resume.', true); log('Paused in the background', 'This browser sample scans only while visible.'); } });
window.addEventListener('pagehide', () => { if (active()) stop(); });
new ResizeObserver(draw).observe(ui['camera-stage']);
// Remove old boxes even if a network request stalls; they are not a fresh observation.
setInterval(() => { if (state.mode === 'live' && state.phase === 'running' && state.detections.length && performance.now() - state.lastResultAt > 2500) { state.detections = []; draw(); setStatus('Waiting for a fresh result', 'Old detections were cleared while the next frame is analyzed.', 'WAITING'); } }, 500);
for (const mode of ['sound', 'speech', 'vibration']) { ui[`${mode}-mode`].disabled = !supports[mode]; if (!supports[mode]) ui[`${mode}-mode`].checked = false; }
ui['vibration-note'].textContent = supports.vibration ? 'Available API · test on your device' : 'Unavailable in this browser';
if (!supports.speech) ui['speech-note'].textContent = 'Unavailable in this browser';
renderControls();
draw();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => { /* The live sample can run without offline installation. */ });
