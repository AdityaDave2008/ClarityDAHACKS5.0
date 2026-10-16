// Camera/speech controller. Detection is supplied by a separate adapter.
export class CameraFeature {
  constructor({ video, mediaDevices, secure = true, speech, Utterance, emit = () => {}, render = () => {},
    now = () => performance.now(), schedule = setTimeout, unschedule = clearTimeout, development = false }) {
    Object.assign(this, { video, mediaDevices, secure, speech, Utterance, emit, render, now, schedule, unschedule, development });
    this.state = { phase: 'off', camera: 'Camera off. Tap Start when ready.', detection: 'Detection not connected.',
      distance: 'Not available', obstacle: '', speechEnabled: false, announcements: 'screen-reader',
      speechStatus: 'Spoken alerts off.' };
    this.generation = 0;
    this.pending = null;
    this.stream = null;
    this.detector = null;
    this.detectionRunning = false;
    this.cooldownMs = 3000;
    this.repeatCount = 1;
    this.lastObstacleAt = -Infinity;
    this.speechSupported = Boolean(speech && Utterance);
    this.voices = [];
    this.refreshVoices = () => {
      try { this.voices = this.speech?.getVoices() || []; } catch { this.voices = []; }
    };
    this.refreshVoices();
    this.speech?.addEventListener?.('voiceschanged', this.refreshVoices);
    if (!this.speechSupported) this.state.speechStatus = 'Speech is unavailable. Use screen-reader announcements and visible messages.';
  }

  update(message = '') {
    this.render({ ...this.state, pending: Boolean(this.pending), speechSupported: this.speechSupported }, message);
    if (message && this.state.announcements === 'app-voice' && this.state.speechEnabled) this.speak(message);
  }

  async start() {
    if (this.pending || this.state.phase !== 'off') return;
    if (!this.secure) {
      this.state.camera = 'Camera needs a secure connection. Use HTTPS on a phone, or localhost on your computer.';
      this.update(this.state.camera);
      return;
    }
    if (!this.mediaDevices?.getUserMedia) {
      this.state.camera = 'Camera access is unavailable in this browser. Open this page in Safari or Chrome over HTTPS.';
      this.update(this.state.camera);
      return;
    }
    const run = ++this.generation;
    // Keep this lock until the browser settles permission, even after Cancel.
    const request = {};
    this.pending = request;
    this.state.phase = 'requesting';
    this.state.camera = 'Requesting camera permission. Choose Allow in the browser prompt, or Cancel camera request below.';
    this.update(this.state.camera);
    let stream;
    try {
      try {
        stream = await this.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      } catch (error) {
        if (run !== this.generation) return;
        if (!['OverconstrainedError', 'NotFoundError'].includes(error.name)) throw error;
        stream = await this.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      if (run !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.emit('clearpath:permissionchange', { kind: 'camera', state: 'granted' });
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => {
          if (run === this.generation) this.stop('Camera interrupted. Close other camera apps, then tap Start again.');
        });
      }
      this.video.srcObject = stream;
      this.video.muted = true;
      try { await this.video.play(); }
      catch { throw Object.assign(new Error(), { name: 'PlaybackError' }); }
      if (run !== this.generation) return;
      this.state.phase = 'active';
      this.state.camera = 'Camera active.';
      this.update('Camera active.');
      this.emit('camera:started', { video: this.video, runId: run });
      // A listener may stop the camera synchronously.
      if (run === this.generation) void this.startDetection(run);
    } catch (error) {
      if (run !== this.generation) return;
      if (this.pending === request) this.pending = null;
      const messages = {
        NotAllowedError: 'Camera permission denied. Allow camera access in this site’s browser permissions, then tap Start.',
        SecurityError: 'Camera access is blocked. Open this page directly over HTTPS and check browser camera permissions.',
        NotFoundError: 'No camera found. Connect a camera or use a phone, then tap Start.',
        NotReadableError: 'Camera unavailable or busy. Close other camera apps, then tap Start.',
        AbortError: 'The camera could not start. Try Start again.',
        PlaybackError: 'Camera preview could not play. Tap Start to retry, or reopen this page in Safari or Chrome.',
      };
      this.stop(messages[error.name] || 'Camera could not start. Check camera access and close other camera apps, then tap Start.');
    } finally {
      if (this.pending === request) this.pending = null;
      this.update();
    }
  }

  stop(message = 'Camera off. Tap Start to restart.') {
    const runId = this.generation;
    this.generation++;
    this.stopDetection();
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.state.phase = 'off';
    this.state.camera = this.pending
      ? `${message} A browser permission request may still be open; dismiss it before restarting.` : message;
    this.state.obstacle = '';
    this.unschedule(this.obstacleTimer);
    this.cancelSpeech();
    this.update(this.state.camera);
    this.emit('camera:stopped', { video: this.video, runId, reason: message });
  }

  registerDetector(detector) {
    if (this.state.phase !== 'off' || this.pending) throw new Error('Register a detector before starting the camera.');
    if (detector !== null && typeof detector?.start !== 'function') throw new TypeError('Detector must provide start(context).');
    this.detector = detector;
    this.state.detection = detector ? 'Detection stopped.' : 'Detection not connected.';
    this.update();
  }

  async startDetection(run) {
    if (!this.detector) return;
    const controller = new AbortController();
    this.detectionController = controller;
    this.state.detection = 'Detection starting.';
    this.update();
    try {
      await this.detector.start({ video: this.video, signal: controller.signal,
        onObstacle: () => { if (run === this.generation) this.obstacle(false); },
        onDistance: meters => { if (run === this.generation) this.distance(meters); },
        onStatus: message => {
          if (run === this.generation && this.detectionRunning && !controller.signal.aborted) {
            const changed = this.state.detection !== message;
            this.state.detection = message;
            this.update(changed ? message : '');
          }
        },
        onError: error => {
          if (run === this.generation && !controller.signal.aborted) {
            this.stopDetection();
            this.state.detection = error?.message || 'Detection unavailable. Stop and Start to retry; camera remains active.';
            this.update(this.state.detection);
          }
        },
      });
      if (run !== this.generation || controller.signal.aborted) return;
      this.detectionRunning = true;
      this.state.detection = 'Detection running.';
      this.update(this.state.detection);
    } catch (error) {
      if (run !== this.generation || controller.signal.aborted) return;
      this.stopDetection();
      this.state.detection = error?.message || 'Detection unavailable. Stop and Start to retry; camera remains active.';
      this.update(this.state.detection);
    }
  }

  stopDetection() {
    this.detectionRunning = false;
    this.detectionController?.abort();
    this.detectionController = null;
    this.state.detection = this.detector ? 'Detection stopped.' : 'Detection not connected.';
    this.unschedule(this.distanceTimer);
    this.state.distance = 'Not available';
    this.unschedule(this.obstacleTimer);
    this.state.obstacle = '';
    this.lastObstacleAt = -Infinity;
    this.cancelSpeech();
    this.emit('camera:detection-stopped', {});
  }

  distance(meters) {
    if (!this.detectionRunning) return;
    this.unschedule(this.distanceTimer);
    this.state.distance = Number.isFinite(meters) && meters > 0 ? `Approximately ${meters.toFixed(1)} metres` : 'Not available';
    this.update();
    if (this.state.distance !== 'Not available') this.distanceTimer = this.schedule(() => {
      this.state.distance = 'Not available';
      this.update();
    }, 3000);
  }

  obstacle(simulated = false) {
    if (simulated ? !this.development : !this.detectionRunning || this.state.phase !== 'active') return false;
    if (this.now() - this.lastObstacleAt < this.cooldownMs) return false;
    this.lastObstacleAt = this.now();
    this.state.obstacle = simulated ? 'Simulation: Object ahead. No real detection.' : 'Object ahead.';
    this.unschedule(this.obstacleTimer);
    // Render without automatic speech so there is only one spoken obstacle message.
    this.render({ ...this.state, pending: Boolean(this.pending), speechSupported: this.speechSupported }, this.state.obstacle);
    this.emit('camera:obstacle', { simulated });
    if (this.state.speechEnabled) this.speak('Object ahead.', this.repeatCount);
    this.obstacleTimer = this.schedule(() => { this.state.obstacle = ''; this.update(); }, 5000);
    return true;
  }

  cancelSpeech() {
    this.speechGeneration = (this.speechGeneration || 0) + 1;
    try { this.speech?.cancel(); } catch { /* Visible alerts remain available. */ }
    this.utterance = null;
  }

  setRepeatCount(count) {
    const parsed = Number(count);
    this.repeatCount = Number.isFinite(parsed) ? Math.min(5, Math.max(1, Math.round(parsed))) : 1;
  }

  speak(message, repeatCount = 1) {
    if (!this.speechSupported) return;
    this.cancelSpeech();
    const token = this.speechGeneration;
    let remaining = Math.min(5, Math.max(1, Math.round(Number(repeatCount) || 1)));
    const speakNext = () => {
      if (token !== this.speechGeneration) return;
      try {
        const utterance = new this.Utterance(message);
        utterance.lang = 'en-US';
        const voice = this.voices.find(voice => voice.lang?.startsWith('en') && voice.localService);
        if (voice) utterance.voice = voice;
        utterance.onend = () => {
          if (token !== this.speechGeneration) return;
          remaining--;
          if (remaining > 0) speakNext();
        };
        utterance.onerror = event => {
          if (token !== this.speechGeneration || ['canceled', 'interrupted'].includes(event.error)) return;
          this.state.speechEnabled = false;
          this.state.announcements = 'screen-reader';
          this.state.speechStatus = 'Speech could not play. Try Test Speech; screen-reader announcements are available.';
          this.cancelSpeech();
          this.update(this.state.speechStatus);
        };
        this.utterance = utterance;
        this.speech.speak(utterance);
      } catch {
        this.state.speechEnabled = false;
        this.state.announcements = 'screen-reader';
        this.state.speechStatus = 'Speech could not play. Try Test Speech; visible alerts remain available.';
        this.cancelSpeech();
        this.update(this.state.speechStatus);
      }
    };
    speakNext();
  }

  enableSpeech(enabled) {
    this.cancelSpeech();
    this.state.speechEnabled = enabled && this.speechSupported;
    this.state.announcements = this.state.speechEnabled ? 'app-voice' : 'screen-reader';
    this.state.speechStatus = this.state.speechEnabled ? 'Spoken alerts on. Automatic screen-reader announcements off.' : 'Spoken alerts off. Screen-reader announcements on.';
    this.update();
    if (this.state.speechEnabled) this.speak('Spoken alerts enabled.');
  }

  setAnnouncements(value) {
    this.cancelSpeech();
    this.state.announcements = value === 'app-voice' && this.speechSupported ? 'app-voice' : 'screen-reader';
    if (this.state.announcements === 'screen-reader') this.state.speechEnabled = false;
    this.state.speechStatus = this.state.announcements === 'screen-reader'
      ? 'Screen-reader announcements on. Spoken alerts off.' : this.state.speechEnabled
        ? 'Spoken alerts on. Automatic screen-reader announcements off.'
        : 'App voice selected. Enable Spoken Alerts for automatic speech.';
    this.update();
  }

  meaningfulStatus() {
    return [this.state.camera, this.state.detection, `Approximate distance: ${this.state.distance}.`, this.state.obstacle].filter(Boolean).join(' ');
  }

  destroy() {
    this.stop();
    this.speech?.removeEventListener?.('voiceschanged', this.refreshVoices);
  }
}

export function mountCamera(root, platform = window, { onState = () => {} } = {}) {
  const find = id => root.querySelector(`#camera-${id}`);
  const announcer = find('announcer');
  let permissionState = 'prompt';
  let announceTimer;
  function renderPermission(state) {
    const light = find('permission-light');
    const label = find('permission-label');
    if (state.phase === 'active') permissionState = 'granted';
    else if (/permission denied/i.test(state.camera)) permissionState = 'denied';
    const granted = permissionState === 'granted';
    const cameraLabel = granted
      ? state.phase === 'active' ? 'Camera permission allowed — scanning is active' : 'Camera permission allowed'
      : permissionState === 'denied'
        ? 'Camera permission denied — allow it in browser settings, then tap Start'
        : state.phase === 'requesting'
          ? 'Waiting for camera permission — choose Allow in the browser prompt'
          : 'Camera permission needed — tap Start to allow';
    const readyLight = root.ownerDocument.getElementById('ready-permission-light');
    const readyStatus = root.ownerDocument.getElementById('ready-to-walk');
    const readyLabel = root.ownerDocument.getElementById('ready-to-walk-label');
    const settingStatus = root.ownerDocument.getElementById('cameraPermissionSetting');
    [light, readyLight].filter(Boolean).forEach(indicator => {
      indicator.classList.toggle('needs-permission', !granted);
      indicator.classList.toggle('permission-granted', granted);
    });
    if (label) label.textContent = cameraLabel;
    if (readyLabel) readyLabel.textContent = granted ? 'Ready to walk' : 'Not ready to walk';
    if (readyStatus) readyStatus.setAttribute('aria-label', granted ? 'Ready to walk. Camera permission granted.' : `Not ready to walk. ${cameraLabel}`);
    if (settingStatus) settingStatus.textContent = granted
      ? 'Allowed'
      : permissionState === 'denied' ? 'Denied — allow access in browser settings' : 'Not allowed yet';
  }
  const feature = new CameraFeature({
    video: find('video'), mediaDevices: platform.navigator.mediaDevices, secure: platform.isSecureContext,
    speech: platform.speechSynthesis, Utterance: platform.SpeechSynthesisUtterance,
    development: new URLSearchParams(platform.location.search).get('dev') === '1',
    emit: (name, detail) => platform.dispatchEvent(new CustomEvent(name, { detail })),
    render: (state, message) => {
      renderPermission(state);
      find('status').textContent = state.camera;
      root.querySelector('#detection-status').textContent = state.detection;
      find('distance').textContent = state.distance;
      find('obstacle').textContent = state.obstacle || 'No alert. Keep watching your path.';
      find('start').disabled = state.pending || state.phase !== 'off';
      find('stop').disabled = state.phase === 'off';
      find('stop').textContent = state.phase === 'requesting' ? 'Cancel camera request' : 'Stop camera';
      find('speech').disabled = !state.speechSupported;
      find('speech').setAttribute('aria-pressed', String(state.speechEnabled));
      find('speech').textContent = state.speechEnabled ? 'Disable Spoken Alerts' : 'Enable Spoken Alerts';
      find('test').disabled = find('repeat').disabled = !state.speechSupported;
      find('announcements').value = state.announcements;
      root.querySelector('#speech-status').textContent = state.speechStatus;
      onState(state);
      announcer.setAttribute('aria-live', state.announcements === 'screen-reader' ? 'polite' : 'off');
      if (message || state.announcements !== 'screen-reader') {
        clearTimeout(announceTimer);
        announcer.textContent = '';
        if (message && state.announcements === 'screen-reader') announceTimer = setTimeout(() => { announcer.textContent = message; }, 50);
      }
    },
  });
  find('start').addEventListener('click', () => void feature.start());
  find('stop').addEventListener('click', () => feature.stop());
  find('speech').addEventListener('click', () => feature.enableSpeech(!feature.state.speechEnabled));
  find('test').addEventListener('click', () => feature.speak('Speech test. Object ahead.'));
  find('repeat').addEventListener('click', () => feature.speak(feature.meaningfulStatus()));
  find('announcements').addEventListener('change', event => feature.setAnnouncements(event.target.value));
  find('cooldown').addEventListener('change', event => {
    const seconds = Number(event.target.value);
    if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 30) feature.cooldownMs = seconds * 1000;
    event.target.value = String(feature.cooldownMs / 1000);
  });
  find('simulate').hidden = !feature.development;
  find('simulate').addEventListener('click', () => feature.obstacle(true));
  root.ownerDocument.addEventListener('visibilitychange', () => {
    if (root.ownerDocument.hidden) feature.stop('Camera off because this page was hidden. Tap Start when you return.');
  });
  platform.addEventListener('pagehide', () => feature.stop('Camera off because you left the page. Tap Start to restart.'));
  platform.addEventListener('clearpath:permissionchange', event => {
    if (event.detail?.kind === 'camera') {
      permissionState = event.detail.state;
      renderPermission(feature.state);
    }
  });
  feature.update();
  try {
    const permissionQuery = platform.navigator.permissions?.query?.({ name: 'camera' });
    if (permissionQuery) {
      permissionQuery.then(status => {
        permissionState = status.state;
        renderPermission(feature.state);
        status.addEventListener('change', () => {
          permissionState = status.state;
          renderPermission(feature.state);
        });
      }).catch(() => {});
    }
  } catch { /* Camera permission queries are not supported in every browser. */ }
  return feature;
}

export function exposeCamera(feature, platform = window) {
  platform.clearPathCamera = Object.freeze({ video: feature.video, start: () => feature.start(), stop: () => feature.stop(),
    registerDetector: detector => feature.registerDetector(detector),
    setRepeatCount: count => feature.setRepeatCount(count) });
}
