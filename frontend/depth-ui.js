import { verticalFovFromReference } from './depth-geometry.js';
import { createDepthController, sameDepthConfiguration } from './depth-controller.js';
import { createDepthSensors, depthOrientation } from './depth-sensors.js';
import { MODEL_DOWNLOAD_BYTES, RUNTIME_DOWNLOAD_BYTES } from './depth-model.js';

export function formatDepth(result) {
  if (result?.kind === 'relative') return result.snapshot ? 'Snapshot, not live. Relative depth only. Uncalibrated.' : 'Relative depth only. Uncalibrated.';
  const { lowerMeters: lo, upperMeters: hi, meters } = result ?? {};
  if (result?.kind === 'estimated' && result.source === 'camera-geometry' && result.quantity === 'optical-axis-depth'
    && [lo, hi, meters].every(Number.isFinite) && lo >= .1 && hi <= 20 && lo <= meters && meters <= hi && hi - lo <= .5 * meters) {
    return `Camera estimated: ${(Math.floor(lo * 10) / 10).toFixed(1)}–${(Math.ceil(hi * 10) / 10).toFixed(1)} m optical-axis depth.`;
  }
  return `Depth unavailable. ${result?.reason || 'No valid calibrated estimate.'}`;
}

export function calibrationFromReference({ frame, attitude, revision, cameraHeightM, referenceHeightM,
  distanceM, measurementToleranceM: tolerance, points, referenceDeclared, canvas } = {}) {
  const fail = message => { throw new Error(message); };
  if (typeof frame?.deviceId !== 'string' || !frame.deviceId || !Number.isFinite(frame.capturedAt)
    || !Number.isSafeInteger(revision) || revision < 1 || frame.orientation !== 'portrait' || !(frame.width >= 16 && frame.height >= 16)) fail('Start a confirmed portrait rear camera first.');
  if (!attitude || !Number.isFinite(attitude.timestamp) || Math.abs(attitude.timestamp - frame.capturedAt) > 250
    || !Number.isFinite(attitude.pitchRad) || !Number.isFinite(attitude.rollRad)
    || Math.abs(attitude.pitchRad) > .035 || Math.abs(attitude.rollRad) > .035) fail('Hold the camera level and upright with fresh motion samples when freezing the reference.');
  if (referenceDeclared !== true) fail('Confirm the measured reference setup.');
  if (![cameraHeightM, referenceHeightM, distanceM, tolerance].every(Number.isFinite)
    || cameraHeightM < .2 || cameraHeightM > 3 || tolerance < .01 || tolerance > .2
    || referenceHeightM <= 2*tolerance || distanceM <= 2*tolerance) fail('Enter measured dimensions and a realistic uncertainty (at least 1 cm).');
  if (points?.length !== 2 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)
    || Math.abs(p.x - .5) > .08 || p.y < 0 || p.y > 1)
    || Math.abs(points[0].x - points[1].x) > .03 || Math.abs((points[0].y + points[1].y)/2 - .5) > .03) fail('Mark the top and bottom of a vertical reference centered in the full image.');
  const span = Math.abs(points[1].y - points[0].y);
  if (span < .1 || span > .9) fail('Reference should span 10–90% of the full image height.');
  const verticalFovRad = verticalFovFromReference({ referenceHeightM, distanceM, fractionOfImageHeight: span });
  const pixelError = 4 / (canvas?.height || frame.height);
  const bounds = [-1, 1].map(sign => verticalFovFromReference({ referenceHeightM: referenceHeightM + sign*tolerance,
    distanceM: distanceM - sign*tolerance, fractionOfImageHeight: span - sign*pixelError }));
  if (!verticalFovRad || bounds.some(v => !v)) fail('Reference cannot establish a valid camera field of view.');
  const fovUncertaintyRad = Math.max(.01, ...bounds.map(v => Math.abs(v - verticalFovRad)));
  if (fovUncertaintyRad > .15) fail('Projection uncertainty is too large. Use a larger, more precisely measured reference.');
  return { revision, width: frame.width, height: frame.height, deviceId: frame.deviceId, orientation: frame.orientation, zoom: frame.zoom,
    verticalFovRad, cameraHeightM, projectionMeasured: true, groundPlaneDeclared: false,
    heightUncertaintyM: tolerance, pitchUncertaintyRad: .035, fovUncertaintyRad };
}

/** Optional UI, separate from the existing camera status and alert channels. */
export function mountDepthUI(root, { platform = globalThis, controllerFactory = createDepthController,
  sensors = createDepthSensors(platform) } = {}) {
  const find = name => root.querySelector(`#depth-${name}`);
  if (!find('enable')) return null;
  const preview = find('preview');
  const mapCanvas = find('map');
  const snapshotCanvas = find('snapshot');
  find('download-notice').textContent = `Optional first-use download: ${((MODEL_DOWNLOAD_BYTES + RUNTIME_DOWNLOAD_BYTES)/1e6).toFixed(1)} MB (model and runtime). Geometry works without it. No frames are uploaded.`;
  let current = null, frozen = null, points = [], revision = 0;
  let anchor = { x: .5, y: .8 };
  let session = 0;
  const message = text => { find('calibration-status').textContent = text; };
  function paint() {
    const selected = frozen || current;
    if (!selected) { preview.getContext('2d').clearRect(0, 0, preview.width, preview.height); return; }
    preview.width = selected.canvas.width; preview.height = selected.canvas.height;
    const ctx = preview.getContext('2d');
    ctx.drawImage(selected.canvas, 0, 0);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    for (const p of frozen ? points : [anchor]) {
      const x = p.x * preview.width, y = p.y * preview.height;
      ctx.beginPath(); ctx.moveTo(x-8,y); ctx.lineTo(x+8,y); ctx.moveTo(x,y-8); ctx.lineTo(x,y+8); ctx.stroke();
    }
  }
  function paintMap(map, frame, source) {
    snapshotCanvas.width = source.width; snapshotCanvas.height = source.height;
    snapshotCanvas.getContext('2d').drawImage(source, 0, 0);
    const captured = new Date(Date.now() - Math.max(0, performance.now() - frame.capturedAt));
    find('snapshot-caption').textContent = `Historical snapshot captured ${captured.toLocaleTimeString()}, frame ${frame.sequence}. Not live. Grayscale shows relative structure only, not metres.`;
    mapCanvas.width = map.width; mapCanvas.height = map.height;
    const ctx = mapCanvas.getContext('2d');
    const image = ctx.createImageData(map.width, map.height);
    let min = Infinity, max = -Infinity;
    for (const value of map.data) { min = Math.min(min, value); max = Math.max(max, value); }
    for (let i = 0; i < map.data.length; i++) {
      const value = max > min ? Math.round(255 * (map.data[i]-min)/(max-min)) : 127;
      image.data.set([value,value,value,255], i*4);
    }
    ctx.putImageData(image,0,0);
  }
  const controller = controllerFactory({ sensors,
    onUpdate(state) {
      find('status').textContent = formatDepth(state.ground);
      find('model-status').textContent = formatDepth(state.model);
      mapCanvas.hidden = state.model.kind !== 'relative';
      snapshotCanvas.hidden = mapCanvas.hidden;
      find('snapshot-caption').hidden = mapCanvas.hidden;
    },
    onPreview(canvas, frame, attitude) {
      find('motion-status').textContent = Number.isFinite(attitude?.pitchRad) && Number.isFinite(attitude?.rollRad)
        ? `Tilt down ${(attitude.pitchRad*180/Math.PI).toFixed(1)}°, roll ${(attitude.rollRad*180/Math.PI).toFixed(1)}°. Hold both within ±2° when freezing the projection reference.`
        : attitude?.reason || 'No fresh motion sample. Enable motion orientation.';
      if (current && !sameDepthConfiguration(current.frame, frame)) resetReference('Camera changed. Measure a new reference.');
      current = { canvas, frame, attitude }; if (!frozen) paint();
    },
    onModelMap: paintMap,
  });
  function resetReference(text) {
    frozen = null; points = []; current = null;
    find('ground-contact').checked = false;
    find('reference-declared').checked = false;
    controller.setGroundContact(false); controller.setCalibration(null);
    paint(); message(text);
  }
  function setAnchor(point) {
    anchor = point;
    find('point-x').value = String(Math.round(point.x*100));
    find('point-y').value = String(Math.round(point.y*100));
    find('ground-contact').checked = false;
    controller.setAnchor(point); paint();
  }
  find('enable').addEventListener('change', () => {
    controller.setEnabled(find('enable').checked);
    find('controls').hidden = !find('enable').checked;
    if (!find('enable').checked) { find('model').checked = false; resetReference('Experimental depth off.'); }
  });
  find('motion').addEventListener('click', () => {
    const token = session;
    // Do not put an await before request(): permission must originate in this click.
    sensors.request().then(result => { if (session === token) message(result.reason); });
  });
  find('analyze').addEventListener('click', () => controller.analyzeSnapshot());
  find('model').addEventListener('change', () => { void controller.setModelEnabled(find('model').checked); });
  find('freeze').addEventListener('click', () => {
    if (!current) { message('Start scanning and enable experimental depth first.'); return; }
    if (performance.now() - current.frame.capturedAt > 500) { message('Wait for a fresh frame before freezing.'); return; }
    frozen = current; points = [];
    find('ground-contact').checked = false;
    controller.setGroundContact(false); controller.setCalibration(null);
    paint(); message('Reference frozen. Tap its top and bottom, or enter their image-height percentages below.');
  });
  preview.addEventListener('click', event => {
    if (!current) return;
    const rect = preview.getBoundingClientRect();
    const p = { x: Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)), y: Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)) };
    if (frozen) {
      if (points.length === 2) points = [];
      points.push(p);
      if (points.length === 2) {
        find('reference-top').value = String(Math.min(...points.map(v=>v.y))*100);
        find('reference-bottom').value = String(Math.max(...points.map(v=>v.y))*100);
      }
      paint(); message(`${points.length} reference endpoints selected.`);
    } else setAnchor(p);
  });
  for (const name of ['point-x','point-y']) find(name).addEventListener('change', () => {
    const x = Number(find('point-x').value)/100, y = Number(find('point-y').value)/100;
    if ([x,y].every(v=>Number.isFinite(v) && v>=0 && v<=1)) setAnchor({x,y});
  });
  for (const name of ['reference-top','reference-bottom']) find(name).addEventListener('change', () => {
    if (!frozen) return;
    points = [{x:.5,y:Number(find('reference-top').value)/100},{x:.5,y:Number(find('reference-bottom').value)/100}]; paint();
  });
  find('calibrate').addEventListener('click', () => {
    try {
      if (!frozen || !current || !sameDepthConfiguration(frozen.frame,current.frame)) throw Error('Freeze a reference in the current camera configuration first.');
      const calibration = calibrationFromReference({ ...frozen, revision: ++revision,
        cameraHeightM:Number(find('height').value), referenceHeightM:Number(find('reference-height').value),
        distanceM:Number(find('reference-distance').value), measurementToleranceM:Number(find('tolerance').value)/100,
        points, referenceDeclared:find('reference-declared').checked });
      find('ground-contact').checked = false; controller.setGroundContact(false);
      controller.setCalibration(calibration); frozen = null; points = []; paint();
      message(`Projection calibrated (${Math.round(calibration.verticalFovRad*180/Math.PI)}° vertical FOV). Keep camera height fixed. Select a visible ground-contact point and confirm below.`);
    } catch (error) { message(error.message); }
  });
  const measurementsChanged = () => {
    find('ground-contact').checked = false;
    controller.setGroundContact(false); controller.setCalibration(null);
    message('Measurements changed. Apply measured calibration again before declaring ground contact.');
  };
  for (const name of ['height', 'reference-height', 'reference-distance', 'tolerance']) {
    find(name).addEventListener('input', measurementsChanged);
  }
  find('reference-declared').addEventListener('change', measurementsChanged);
  find('ground-contact').addEventListener('change', () => controller.setGroundContact(find('ground-contact').checked));
  find('reset').addEventListener('click', () => resetReference('Calibration reset. Measure a new reference.'));
  const rotation = () => { session++; controller.invalidateConfiguration(); resetReference('Rotation invalidated calibration. Return to portrait and recalibrate.'); };
  platform.addEventListener?.('orientationchange', rotation);
  platform.screen?.orientation?.addEventListener?.('change', rotation);
  root.ownerDocument.addEventListener('visibilitychange', () => {
    controller.setHidden(root.ownerDocument.hidden);
    if (root.ownerDocument.hidden) { session++; resetReference('Page hidden. Re-enable motion and recalibrate after restart.'); }
  });
  return {
    start() { controller.start(); },
    stop() { session++; controller.stop(); resetReference('Camera stopped. Re-enable motion and recalibrate after restart.'); },
    onFrame(frame, video) {
      const settings = video.srcObject?.getVideoTracks?.()[0]?.getSettings?.() || {};
      controller.onFrame({ ...frame, deviceId:settings.deviceId, facingMode:settings.facingMode, zoom:settings.zoom,
        orientation: depthOrientation(platform) });
    },
  };
}
