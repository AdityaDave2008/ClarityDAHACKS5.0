import { estimateGroundDepth } from './depth-geometry.js';

const unavailable = reason => ({ kind: 'unavailable', source: 'none', reason });
const configKeys = ['width', 'height', 'deviceId', 'orientation', 'zoom'];
export const sameDepthConfiguration = (a, b) => !!a && !!b && configKeys.every(key => a[key] === b[key]);

export function copyDepthCanvas(canvas) {
  const copy = document.createElement('canvas');
  const scale = Math.min(1, 384 / Math.max(canvas.width, canvas.height));
  copy.width = Math.round(canvas.width * scale);
  copy.height = Math.round(canvas.height * scale);
  copy.getContext('2d').drawImage(canvas, 0, 0, copy.width, copy.height);
  return copy;
}

/** No camera ownership, alerts, or v1 error callbacks exist in this controller. */
export function createDepthController({
  sensors, now = () => performance.now(),
  modelFactory = async () => (await import('./depth-model.js')).createDepthModel(),
  groundEstimator = estimateGroundDepth, copyCanvas = copyDepthCanvas,
  onUpdate = () => {}, onPreview = () => {}, onModelMap = () => {}, schedule = setTimeout, unschedule = clearTimeout,
  maxAgeMs = 500,
} = {}) {
  let enabled = false, running = false, hidden = false, generation = 0;
  let calibration = null, groundContact = false;
  let anchor = { x: .5, y: .8 };
  let modelEnabled = false, model = null, loading = null, busy = false;
  let loadGeneration = 0;
  const disposed = new WeakSet();
  let snapshotRequested = false;
  let lastConfiguration = null;
  const timers = {};
  let state = { ground: unavailable('Experimental depth off.'), model: unavailable('Optional model off.') };
  const active = () => enabled && running && !hidden;
  const emit = () => onUpdate({ ...state });
  function publish(channel, result, frame) {
    unschedule(timers[channel]);
    state = { ...state, [channel]: result };
    if (frame && result.kind !== 'unavailable') {
      timers[channel] = schedule(() => {
        state = { ...state, [channel]: unavailable('Depth expired. Waiting for a fresh frame.') };
        emit();
      }, Math.max(0, maxAgeMs - (now() - frame.capturedAt)));
    }
    emit();
  }
  function invalidate(reason) {
    generation++;
    snapshotRequested = false;
    for (const timer of Object.values(timers)) unschedule(timer);
    state = { ground: unavailable(reason), model: unavailable(modelEnabled ? reason : 'Optional model off.') };
    emit();
  }
  function release(candidate) {
    if (!candidate || disposed.has(candidate)) return;
    disposed.add(candidate);
    try { Promise.resolve(candidate.dispose()).catch(() => {}); } catch { /* depth only */ }
  }
  function cancelModel() {
    // Loading has its own epoch: frame/calibration changes do not imply opt-out,
    // but disable must stop downloads/worker work immediately, not after load.
    loadGeneration++;
    const candidate = model;
    model = null;
    loading = null;
    release(candidate);
  }
  async function setModelEnabled(value) {
    modelEnabled = enabled && !!value;
    invalidate(modelEnabled ? 'Loading optional relative model.' : 'Optional model off.');
    if (!modelEnabled) { cancelModel(); return; }
    if (model || loading) return loading;
    const token = ++loadGeneration;
    const isCurrent = () => token === loadGeneration && modelEnabled;
    let candidate;
    loading = (async () => {
      try {
        candidate = await modelFactory();
        // The user can revoke opt-in while the lazy module/factory is pending.
        if (!isCurrent()) { release(candidate); return; }
        model = candidate;
        await candidate.load({ onStatus: status => {
          if (isCurrent() && !hidden) publish('model', unavailable(status?.reason || `Relative model ${status?.status || 'loading'}.`));
        } });
        if (isCurrent() && !hidden) publish('model', unavailable('Relative model ready. Choose Analyze depth snapshot.'));
      } catch {
        if (!isCurrent()) return;
        modelEnabled = false;
        model = null;
        release(candidate);
        publish('model', unavailable('Optional model unavailable. Ground geometry and object detection are unchanged.'));
      } finally {
        // A cancelled generation must never clear a rapid re-enable's load.
        if (token === loadGeneration) loading = null;
      }
    })();
    return loading;
  }
  async function infer(snapshot, frame, token) {
    busy = true;
    const started = now();
    try {
      const map = await model.estimate(snapshot);
      if (token !== generation || !active() || !modelEnabled) return;
      if (now() - started > 15000 || now() < frame.capturedAt) {
        publish('model', unavailable('Snapshot analysis exceeded its time budget.'));
        return;
      }
      if (!Number.isInteger(map?.width) || !Number.isInteger(map?.height) || map.width < 1 || map.height < 1
        || map.data?.length !== map.width * map.height || !Array.from(map.data).every(Number.isFinite)) throw Error('Invalid raw map');
      // No per-frame validated metric reference set exists in this UI. Never fit or
      // reuse a scale from another frame. Raw model values remain relative only.
      onModelMap(map, frame, snapshot);
      publish('model', { kind: 'relative', snapshot: true, producedAt: now(), source: 'relative-model', reason: 'Relative scene structure only. No validated same-frame metric references.',
        frameSequence: frame.sequence, capturedAt: frame.capturedAt, calibrationRevision: calibration?.revision ?? null,
        width: map.width, height: map.height });
    } catch {
      if (token === generation && active()) publish('model', unavailable('Relative inference unavailable. Object detection continues.'));
    } finally {
      busy = false;
    }
  }
  return {
    setEnabled(value) {
      enabled = !!value;
      if (!enabled) { modelEnabled = false; calibration = null; groundContact = false; sensors?.stop(); cancelModel(); }
      invalidate(enabled ? 'Calibrate projection and enable motion to estimate ground depth.' : 'Experimental depth off.');
    },
    setModelEnabled,
    analyzeSnapshot() {
      if (!active() || !modelEnabled || !model || loading || busy) {
        publish('model', unavailable(busy ? 'Snapshot analysis already in progress.' : 'Enable the model and start scanning before analyzing a snapshot.'));
        return false;
      }
      invalidate('Capturing a frozen scene for relative analysis.');
      snapshotRequested = true;
      return true;
    },
    setCalibration(value) { calibration = value ? { ...value } : null; invalidate('Calibration changed. Waiting for a fresh frame.'); },
    setAnchor(value) {
      if (![value?.x, value?.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return;
      anchor = { x: value.x, y: value.y }; groundContact = false; invalidate('Point changed. Confirm ground contact again.');
    },
    setGroundContact(value) { groundContact = !!value; invalidate('Ground declaration changed. Waiting for a fresh frame.'); },
    start() { running = true; lastConfiguration = null; invalidate('Waiting for a fresh frame.'); },
    stop() { running = false; calibration = null; groundContact = false; sensors?.stop(); invalidate('Camera stopped. Re-enable motion and recalibrate on restart.'); },
    setHidden(value) { hidden = !!value; if (hidden) { calibration = null; groundContact = false; sensors?.stop(); } invalidate('Visibility changed. Recalibration required.'); },
    invalidateConfiguration() { calibration = null; groundContact = false; invalidate('Camera configuration changed. Recalibrate in portrait orientation.'); },
    onFrame(input) {
      if (!active()) return;
      try {
        const frame = { sequence: input.sequence, capturedAt: input.capturedAt,
          width: input.sourceWidth, height: input.sourceHeight, deviceId: input.deviceId, orientation: input.orientation, zoom: input.zoom };
        if (!Number.isFinite(frame.capturedAt) || now() - frame.capturedAt > 2500 || now() < frame.capturedAt) {
          publish('ground', unavailable('Camera frame too old for depth.')); return;
        }
        if ((calibration && !sameDepthConfiguration(calibration, frame))
          || (lastConfiguration && !sameDepthConfiguration(lastConfiguration, frame))) {
          calibration = null; groundContact = false; invalidate('Camera configuration changed. Recalibrate.');
        }
        lastConfiguration = frame;
        const snapshot = copyCanvas(input.canvas); // Synchronous: detector reuses its canvas.
        const attitude = sensors?.snapshot(frame.capturedAt);
        onPreview(snapshot, frame, attitude);
        if (now() - frame.capturedAt > maxAgeMs) publish('ground', unavailable('Camera frame too old for live ground depth.'));
        else if (!calibration || !groundContact) publish('ground', unavailable('Calibrate and explicitly declare the marked point is on flat level ground.'));
        else if (input.facingMode !== 'environment' || frame.orientation !== 'portrait') publish('ground', unavailable('Only a confirmed portrait rear camera is supported.'));
        else {
          const result = groundEstimator({ anchor: { ...anchor, groundContact: true },
            calibration: { ...calibration, groundPlaneDeclared: true }, attitude, frame, now: now() });
          publish('ground', { ...result, frameSequence: frame.sequence, capturedAt: frame.capturedAt,
            calibrationRevision: calibration.revision }, frame);
        }
        if (snapshotRequested && modelEnabled && model && !loading && !busy) {
          snapshotRequested = false;
          publish('model', unavailable('Analyzing a frozen scene. This will not be live depth.'));
          void infer(snapshot, frame, generation);
        }
      } catch {
        publish('ground', unavailable('Experimental depth unavailable. Object detection continues.'));
      }
    },
  };
}
