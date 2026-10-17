// Application worker, not part of the vendored upstream runtime.
// No fetch/upload of frame data. Only immutable model assets are downloaded.
import { createDepthModel } from '../depth-model.js';
const model = createDepthModel();
self.onmessage = async ({ data: message }) => {
  const { id, type } = message;
  try {
    let result;
    if (type === 'load') {
      result = await model.load({ onStatus: status => self.postMessage({ status }) });
    } else if (type === 'estimate') {
      const canvas = new OffscreenCanvas(message.width, message.height);
      canvas.getContext('2d').putImageData(new ImageData(message.pixels, message.width, message.height), 0, 0);
      result = await model.estimate(canvas);
    } else throw new Error('Unknown depth worker request');
    self.postMessage({ id, result }, result?.data ? [result.data.buffer] : []);
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
