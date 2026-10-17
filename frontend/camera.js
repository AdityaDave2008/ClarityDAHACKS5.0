import { drawDetectionOverlay } from './logic.js';
import { createPictureInPicture } from './picture-in-picture.js';
import { cameraFrameAvailable } from './video-frames.js';

// Camera/speech controller. Detection is supplied by a separate adapter.
export class CameraFeature {
  constructor({ video, mediaDevices, secure = true, speech, Utterance, emit = () => {}, render = () => {},
    now = () => performance.now(), schedule = (callback, ms) => setTimeout(callback, ms),
    unschedule = timer => clearTimeout(timer), development = false, isVisible = () => true, onStop = () => {} }) {
    Object.assign(this, { video, mediaDevices, secure, speech, Utterance, emit, render, now, schedule, unschedule, development, isVisible, onStop });
    this.state = { phase: 'off', previewOnly: false, camera: 'Camera off. Tap Start when ready.', detection: 'Detection not connected.',
      distance: 'Not available', detections: [], result: null, obstacle: '', speechEnabled: false, announcements: 'screen-reader',
      speechStatus: 'Spoken alerts off.', performance: 'No measurements yet.' };
    this.generation = 0;
    this.pending = null;
    this.stream = null;
    this.detector = null;
    this.detectionRunning = false;
    this.cooldownMs = 3000;
    this.repeatCount = 1;
    this.lastObstacleAt = -Infinity;
    this.stallCheckMs = 1000;
    this.stallLimitMs = 4000;
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
    const request = { kind: 'permission' };
    const controller = new AbortController();
    this.startupController = controller;
    this.state.startupError = false;
    this.pending = request;
    let stream;
    try {
      this.state.phase = 'requesting';
      this.state.camera = 'Requesting camera permission. Choose Allow in the browser prompt, or Cancel camera request below.';
      this.update(this.state.camera);
      try {
        stream = await this.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      } catch (error) {
        if (run !== this.generation) return;
        if (!['OverconstrainedError', 'NotFoundError'].includes(error.name)) throw error;
        stream = await this.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      if (run !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.emit('myeyes:permissionchange', { kind: 'camera', state: 'granted' });
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
      this.watchForStall(run);
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
      if (this.startupController === controller) this.startupController = null;
      if (this.pending === request) this.pending = null;
      this.update();
    }
  }

  stop(message = 'Camera off. Tap Start to restart.') {
    const runId = this.generation;
    this.generation++;
    this.startupController?.abort();
    this.startupController = null;
    this.state.startupError = false;
    this.state.previewOnly = false;
    this.unschedule(this.stallTimer);
    this.stallTimer = null;
    this.stopDetection();
    this.onStop();
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

  pauseForPictureInPicture() {
    if (this.state.phase !== 'active' || this.state.previewOnly) return;
    this.state.previewOnly = true;
    this.unschedule(this.stallTimer);
    this.stallTimer = null;
    this.stopDetection();
    this.state.camera = 'Picture in picture preview only. The browser may pause the camera.';
    this.state.detection = 'Detection paused while this page is hidden. Return to resume scanning.';
    this.update();
  }

  resumeFromPictureInPicture() {
    if (!this.state.previewOnly || this.state.phase !== 'active' || !this.isVisible()) return;
    this.state.previewOnly = false;
    this.state.camera = 'Camera active. Resuming foreground detection.';
    this.update();
    this.watchForStall(this.generation);
    void this.startDetection(this.generation);
  }

  // The preview can freeze after prolonged use or an OS interruption while the
  // track still reports live. Detect a frozen preview and attempt one recovery.
  watchForStall(run) {
    this.unschedule(this.stallTimer);
    this.lastFrameTime = Number(this.video?.currentTime) || 0;
    this.lastFrameAt = this.now();
    this.recoveryAttempts = 0;
    const check = () => {
      if (run !== this.generation || this.state.phase !== 'active') return;
      const currentTime = Number(this.video?.currentTime) || 0;
      if (currentTime !== this.lastFrameTime) {
        this.lastFrameTime = currentTime;
        this.lastFrameAt = this.now();
        this.recoveryAttempts = 0;
        if (this.state.camera.startsWith('Camera preview stalled.')) {
          this.state.camera = 'Camera active.';
          this.update();
        }
      } else if (this.now() - this.lastFrameAt >= this.stallLimitMs) {
        this.lastFrameAt = this.now();
        this.recoveryAttempts += 1;
        if (this.recoveryAttempts > 2) {
          this.stop('Camera preview froze and could not recover. Tap Start to restart the camera.');
          return;
        }
        this.state.camera = `Camera preview stalled. Recovering (attempt ${this.recoveryAttempts} of 2).`;
        this.cancelSpeech();
        this.state.detections = [];
        this.state.result = null;
        this.state.obstacle = '';
        this.update(this.state.camera);
        try { void Promise.resolve(this.video.play?.()).catch(() => {}); } catch { /* Restart remains available. */ }
      }
      this.stallTimer = this.schedule(check, this.stallCheckMs);
    };
    this.stallTimer = this.schedule(check, this.stallCheckMs);
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
    this.detectionRunning = true;
    try {
      await this.detector.start({ video: this.video, signal: controller.signal,
        onObstacle: () => { if (run === this.generation && !controller.signal.aborted && this.isVisible()) this.obstacle(false); },
        onResult: result => {
          if (run === this.generation && !controller.signal.aborted && this.state.phase === 'active' && this.isVisible()) this.acceptResult(result);
        },
        onDistance: meters => { if (run === this.generation && !controller.signal.aborted && this.isVisible()) this.distance(meters); },
        onMetrics: metrics => { if (run === this.generation && !controller.signal.aborted) this.performance(metrics); },
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
      if (!this.state.result) this.state.detection = 'Detection running.';
      this.update(this.state.detection);
    } catch (error) {
      if (run !== this.generation || controller.signal.aborted) return;
      this.stopDetection();
      this.state.detection = error?.message || 'Detection unavailable. Stop and Start to retry; camera remains active.';
      this.update(this.state.detection);
    }
  }

  acceptResult(result) {
    const sequence = result?.frame?.sequence;
    if (!Number.isInteger(sequence) || sequence <= (this.resultSequence || 0) ||
        !Number.isFinite(result.ageMs) || result.ageMs < 0 || result.ageMs >= 2500 ||
        ![result.sourceWidth, result.sourceHeight].every(value => Number.isInteger(value) && value > 0)) return;
    this.resultSequence = sequence;
    const detections = (Array.isArray(result.detections) ? result.detections : []).filter(item => {
      const box = item?.bbox;
      return typeof item?.label === 'string' && item.label.length > 0 && Number.isFinite(item.confidence) &&
        item.confidence >= 0 && item.confidence <= 1 && box &&
        [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
        box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 &&
        box.x + box.width <= 1.001 && box.y + box.height <= 1.001;
    }).slice(0, 50).map(item => ({ ...item, label: item.label.slice(0, 80), bbox: { ...item.bbox } }));
    this.state.detections = detections;
    this.state.result = { sequence, sourceWidth: result.sourceWidth, sourceHeight: result.sourceHeight };
    this.state.detection = result.alert?.triggered ? 'Object confirmed in the marked image zone.'
      : result.alert?.reason === 'confirming' ? 'Object seen. Checking another frame to confirm…'
      : result.alert?.reason === 'cooldown' ? 'Object remains in the image zone. Alert cooldown active.'
      : detections.length ? `Detection running. ${detections.length} supported object${detections.length === 1 ? '' : 's'} visible.`
      : 'Detection running. No supported objects detected. Keep watching your path.';
    this.unschedule(this.resultTimer);
    this.resultTimer = this.schedule(() => {
      this.state.detections = [];
      this.state.result = null;
      this.state.detection = 'Waiting for a fresh result. Old detections cleared.';
      this.update();
    }, 2500 - result.ageMs);
    // Per-frame results are visible/readable, not repeated automatic announcements.
    this.update();
  }

  stopDetection() {
    this.detectionRunning = false;
    this.unschedule(this.resultTimer);
    this.resultSequence = 0;
    this.state.detections = [];
    this.state.result = null;
    this.detectionController?.abort();
    this.detectionController = null;
    this.state.detection = this.detector ? 'Detection stopped.' : 'Detection not connected.';
    this.state.performance = 'No measurements yet.';
    this.unschedule(this.distanceTimer);
    this.state.distance = 'Not available';
    this.unschedule(this.obstacleTimer);
    this.state.obstacle = '';
    this.lastObstacleAt = -Infinity;
    this.cancelSpeech();
    this.emit('camera:detection-stopped', {});
  }

  performance(metrics) {
    const { lastMs, averageMs, captureMaxSide } = metrics || {};
    if (![lastMs, averageMs, captureMaxSide].every(value => Number.isFinite(value) && value >= 0)) return;
    this.state.performance = `Capture to result: ${Math.round(lastMs)} ms (recent average ${Math.round(averageMs)} ms) at ${Math.round(captureMaxSide)} px capture.`;
    this.update();
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
    if (!simulated && (!this.isVisible() || !cameraFrameAvailable(this.video) || this.state.camera.startsWith('Camera preview stalled.'))) return false;
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
  const find = id => root.querySelector(`#camera-${id}`)
    || root.ownerDocument.getElementById(`camera-${id}`);
  const announcer = find('announcer');
  let permissionState = 'prompt';
  let announceTimer;
  const previewOnlyPiP = new URLSearchParams(platform.location.search).get('pip') === 'preview';
  let feature;
  const pip = createPictureInPicture({ video: find('video'), doc: root.ownerDocument, platform,
    onChange() { feature?.update(); },
    onHiddenExit() { if (feature?.state.phase !== 'off') feature?.stop('Camera off because the floating camera closed. Tap Start to restart.'); },
  });
  function renderPermission(state) {
    const light = find('permission-light');
    const label = find('permission-label');
    if (state.phase === 'active') permissionState = 'granted';
    else if (/permission denied/i.test(state.camera)) permissionState = 'denied';
    const granted = permissionState === 'granted';
    const cameraLabel = granted
      ? state.phase === 'active'
        ? state.previewOnly ? 'Camera permission allowed — preview only, detection paused' : 'Camera permission allowed — scanning is active'
        : 'Camera permission allowed'
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
  feature = new CameraFeature({
    video: find('video'), mediaDevices: platform.navigator.mediaDevices, secure: platform.isSecureContext,
    speech: platform.speechSynthesis, Utterance: platform.SpeechSynthesisUtterance,
    isVisible: () => !root.ownerDocument.hidden || pip.isActive(),
    onStop: () => pip.close(),
    development: new URLSearchParams(platform.location.search).get('dev') === '1',
    emit: (name, detail) => platform.dispatchEvent(new CustomEvent(name, { detail })),
    render: (state, message) => {
      renderPermission(state);
      const startup = find('startup');
      if (startup) {
        startup.hidden = !(state.phase === 'loading' || state.startupError);
        find('startup-title').textContent = state.startupError ? 'Model unavailable' : 'Loading detection model';
        find('startup-status').textContent = state.camera;
        find('startup-retry').hidden = !state.startupError;
      }
      find('status').textContent = state.camera;
      find('status').setAttribute('aria-busy', String(state.phase === 'loading'));
      const performanceNode = find('performance');
      if (performanceNode) performanceNode.textContent = state.performance;
      root.querySelector('#detection-status').textContent = state.detection;
      const distance = find('distance');
      if (distance) distance.textContent = state.distance;
      const objects = find('objects');
      if (objects) objects.textContent = state.result
        ? state.detections.length ? state.detections.map(item => `${item.label} ${Math.round(item.confidence * 100)}%`).join(' · ')
          : 'No supported objects in this frame. This does not mean the path is safe.'
        : state.phase === 'off' ? 'Start scanning to see supported objects.' : 'No fresh detections to display.';
      drawDetectionOverlay(find('overlay'), find('video'), state.detections, platform.devicePixelRatio, state.result);
      const obstacle = find('obstacle');
      if (obstacle) obstacle.textContent = state.obstacle || 'No alert. Keep watching your path.';
      find('start').disabled = state.pending || state.phase !== 'off';
      find('start').textContent = state.startupError ? 'Retry' : 'Start scanning';
      find('stop').disabled = state.phase === 'off' && !state.startupError;
      find('stop').textContent = state.phase === 'loading' || state.startupError ? 'Cancel' : state.phase === 'requesting' ? 'Cancel camera request' : 'Stop scanning';
      const pipButton = find('pip');
      const pipState = pip.snapshot();
      if (pipButton) {
        pipButton.disabled = state.phase !== 'active' || pipState.opening;
        pipButton.textContent = pipState.active ? 'Close floating camera' : 'Open floating camera';
        pipButton.setAttribute('aria-pressed', String(pipState.active));
      }
      const pipStatus = find('pip-status');
      if (pipStatus) pipStatus.textContent = `${previewOnlyPiP ? 'Preview only: detection pauses while this page is hidden. ' : ''}${pipState.message}`;
      const resumeButton = find('pip-resume');
      if (resumeButton) resumeButton.hidden = !pipState.canResume;
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
  find('startup-retry')?.addEventListener('click', () => void feature.start());
  find('startup-cancel')?.addEventListener('click', () => feature.stop());
  find('start').addEventListener('click', () => void feature.start());
  find('stop').addEventListener('click', () => feature.stop());
  find('pip')?.addEventListener('click', () => {
    if (pip.isActive()) pip.close();
    else if (feature.state.phase === 'active') pip.open();
  });
  find('pip-resume')?.addEventListener('click', () => pip.resume());
  find('speech').addEventListener('click', () => feature.enableSpeech(!feature.state.speechEnabled));
  find('test').addEventListener('click', () => feature.speak('Speech test. Object ahead.'));
  find('repeat').addEventListener('click', () => feature.speak(feature.meaningfulStatus()));
  find('announcements').addEventListener('change', event => feature.setAnnouncements(event.target.value));
  find('cooldown').addEventListener('change', event => {
    const seconds = Number(event.target.value);
    if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 5) feature.cooldownMs = seconds * 1000;
    event.target.value = String(feature.cooldownMs / 1000);
  });
  find('simulate').hidden = !feature.development;
  find('simulate').addEventListener('click', () => feature.obstacle(true));
  const visibilityChanged = () => {
    if (root.ownerDocument.hidden && !pip.isActive()) feature.stop('Camera off because this page was hidden without a floating camera. Tap Start when you return.');
    else if (previewOnlyPiP && root.ownerDocument.hidden) feature.pauseForPictureInPicture();
    else if (previewOnlyPiP) feature.resumeFromPictureInPicture();
  };
  const pageHidden = () => feature.stop('Camera off because you left the page. Tap Start to restart.');
  root.ownerDocument.addEventListener('visibilitychange', visibilityChanged);
  platform.addEventListener('pagehide', pageHidden);
  const destroy = feature.destroy.bind(feature);
  feature.destroy = () => {
    root.ownerDocument.removeEventListener?.('visibilitychange', visibilityChanged);
    platform.removeEventListener?.('pagehide', pageHidden);
    destroy();
    pip.destroy();
  };
  platform.addEventListener('myeyes:permissionchange', event => {
    if (event.detail?.kind === 'camera') {
      permissionState = event.detail.state;
      renderPermission(feature.state);
    }
  });
  const redraw = () => drawDetectionOverlay(find('overlay'), feature.video, feature.state.detections, platform.devicePixelRatio, feature.state.result);
  platform.addEventListener('resize', redraw);
  feature.video.addEventListener?.('resize', redraw);
  if (platform.ResizeObserver && find('overlay')) {
    const observer = new platform.ResizeObserver(redraw);
    observer.observe(find('overlay'));
  }
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
  platform.myEyesCamera = Object.freeze({ video: feature.video, start: () => feature.start(), stop: () => feature.stop(),
    registerDetector: detector => feature.registerDetector(detector),
    setRepeatCount: count => feature.setRepeatCount(count) });
}
