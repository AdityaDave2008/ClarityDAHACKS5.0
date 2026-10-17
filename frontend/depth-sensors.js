// DeviceOrientation is not camera calibration. This adapter supports only an
// upright portrait rear camera; other configurations fail closed.
export function portraitRearAttitude({ beta, gamma } = {}, orientation) {
  if (orientation !== 0 || !Number.isFinite(beta) || !Number.isFinite(gamma)
    || beta < 45 || beta > 135 || Math.abs(gamma) > 30) return null;
  return rearCameraAttitude({ beta, gamma });
}

/** Mathematical W3C rear-camera convention, separate from supported pose gates. */
export function rearCameraAttitude({ beta, gamma } = {}) {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  const b = beta * Math.PI / 180;
  const g = gamma * Math.PI / 180;
  // W3C intrinsic Z-X'-Y'' rotation. Rear optical axis is -device Z,
  // image right is device X and image down is -device Y.
  return {
    pitchRad: Math.asin(Math.cos(b) * Math.cos(g)),
    rollRad: Math.atan2(Math.cos(b) * Math.sin(g), Math.sin(b)),
  };
}

export function depthOrientation(platform = globalThis) {
  const angle = platform.screen?.orientation?.angle ?? platform.orientation;
  const type = platform.screen?.orientation?.type;
  return angle === 0 && (!type || type === 'portrait-primary') ? 'portrait' : 'unsupported';
}

export function createDepthSensors(platform = globalThis) {
  const now = platform.now ?? (() => performance.now());
  const orientation = () => depthOrientation(platform) === 'portrait' ? 0 : null;
  let sample = null;
  let samples = [];
  let generation = 0;
  let listening = false;
  let reason = 'Enable motion permission for calibrated ground estimates.';
  const unavailable = () => ({ kind: 'unavailable', reason });
  function receive(event) {
    const attitude = portraitRearAttitude(event, orientation());
    sample = attitude ? { ...attitude, timestamp: now() } : null;
    if (!sample) { samples = []; reason = 'Use an upright portrait rear camera. This pose is unsupported.'; }
    else { samples.push(sample); samples = samples.filter(item => now() - item.timestamp <= 1000).slice(-128); }
  }
  function stop() {
    generation += 1;
    sample = null; samples = [];
    if (listening) platform.removeEventListener('deviceorientation', receive);
    listening = false;
    reason = 'Motion stopped. Enable motion again to resume.';
  }
  return {
    async request() {
      stop();
      const token = generation;
      const api = platform.DeviceOrientationEvent;
      if (!api || !platform.addEventListener) {
        reason = 'Motion orientation is unavailable on this browser.';
        return unavailable();
      }
      try {
        // Invoke before the first await, preserving Safari's user-activation requirement.
        const permission = typeof api.requestPermission === 'function' ? await api.requestPermission() : 'granted';
        if (generation !== token) return unavailable();
        if (permission !== 'granted') { reason = 'Motion permission denied. Object detection still works.'; return unavailable(); }
        platform.addEventListener('deviceorientation', receive);
        listening = true;
        reason = 'Waiting for a fresh portrait motion sample.';
        return { kind: 'ready', reason };
      } catch {
        reason = 'Motion permission unavailable. Object detection still works.';
        return unavailable();
      }
    },
    snapshot(capturedAt) {
      if (orientation() !== 0) { sample = null; samples = []; reason = 'Portrait orientation required. Recalibrate after rotation.'; }
      const selected = Number.isFinite(capturedAt) ? samples.findLast(item => item.timestamp <= capturedAt) : sample;
      const age = selected ? now() - selected.timestamp : Infinity;
      if (!selected || age < 0 || age > 250) {
        if (sample) reason = 'Motion sample expired. Waiting for fresh orientation.';
        return unavailable();
      }
      return { ...selected };
    },
    stop,
  };
}
