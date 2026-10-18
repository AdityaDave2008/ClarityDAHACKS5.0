export function containRect(containerWidth, containerHeight, imageWidth, imageHeight) {
  if (![containerWidth, containerHeight, imageWidth, imageHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { x: (containerWidth - width) / 2, y: (containerHeight - height) / 2, width, height };
}

export function captureSize(width, height, maximum = 640) {
  if (!(width > 0 && height > 0)) throw new Error('The camera has not supplied a frame yet.');
  const scale = Math.min(1, maximum / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Normalized model coordinates map to the centered, unmirrored contain preview.
export function detectionRect(fit, box) {
  return { x: fit.x + box.x * fit.width, y: fit.y + box.y * fit.height,
    width: box.width * fit.width, height: box.height * fit.height };
}

// Visual size is only a rough proximity cue, not a distance measurement.
export function appearsClose(box) {
  if (!box || ![box.y, box.width, box.height].every(Number.isFinite)) return false;
  const bottom = box.y + box.height;
  return box.height >= 0.32 || box.width * box.height >= 0.12 || bottom >= 0.82;
}

export function drawDetectionOverlay(canvas, video, detections, pixelRatio = 1, source = null) {
  if (!canvas?.getContext) return;
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(3, Math.max(1, pixelRatio || 1));
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  if (source && (source.sourceWidth !== video.videoWidth || source.sourceHeight !== video.videoHeight)) return;
  const fit = containRect(bounds.width, bounds.height, video.videoWidth, video.videoHeight);
  if (!fit) return;
  context.save();
  context.beginPath();
  context.rect(fit.x, fit.y, fit.width, fit.height);
  context.clip();
  for (const detection of detections) {
    const box = detectionRect(fit, detection.bbox);
    const near = appearsClose(detection.bbox);
    const highlight = near ? '#ffd43b' : '#42d392';
    context.strokeStyle = highlight;
    context.lineWidth = 4;
    context.strokeRect(box.x, box.y, box.width, box.height);
    context.strokeStyle = near ? '#ffd43b' : '#10251a';
    context.lineWidth = 2;
    context.strokeRect(box.x, box.y, box.width, box.height);
    // Only call out proximity when the box actually looks close. A "FAR" badge on
    // every distant object adds noise without telling the user anything useful.
    const label = `${near ? 'NEAR - ' : ''}${detection.label} ${Math.round(detection.confidence * 100)}%`;
    context.font = '600 13px system-ui, sans-serif';
    const labelWidth = Math.min(fit.width, context.measureText(label).width + 12);
    const x = Math.max(fit.x, Math.min(box.x, fit.x + fit.width - labelWidth));
    const y = Math.max(fit.y, Math.min(box.y - 24, fit.y + fit.height - 24));
    context.fillStyle = highlight;
    context.fillRect(x, y, labelWidth, 24);
    context.fillStyle = '#102016';
    context.fillText(label, x + 6, y + 17, Math.max(1, labelWidth - 12));
  }
  context.restore();
}
