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
