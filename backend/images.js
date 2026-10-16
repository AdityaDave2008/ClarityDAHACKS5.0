import sharp from 'sharp';
import { LIMITS } from './config.js';
import { ApiError } from './errors.js';

export async function decodeFrame(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ApiError(400, 'INVALID_IMAGE', 'Send a non-empty JPEG or PNG image.');
  if (buffer.length > LIMITS.maxFrameBytes) throw new ApiError(413, 'FRAME_TOO_LARGE', 'Frame exceeds the 1 MiB limit.');
  const expected = { 'image/jpeg': 'jpeg', 'image/png': 'png' }[contentType];
  if (!expected) throw new ApiError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Encode frames as image/jpeg or image/png.');
  try {
    const image = sharp(buffer, { limitInputPixels: LIMITS.maxImagePixels, failOn: 'warning', sequentialRead: true });
    const metadata = await image.metadata();
    if (metadata.format !== expected) throw new ApiError(415, 'IMAGE_TYPE_MISMATCH', 'The image bytes do not match the declared Content-Type.');
    if ((metadata.pages || 1) > 1) throw new ApiError(415, 'ANIMATED_IMAGE', 'Send a single still frame.');
    if (!metadata.width || !metadata.height) throw new ApiError(400, 'INVALID_IMAGE', 'The image has no valid dimensions.');
    if (metadata.width > LIMITS.maxImageSide || metadata.height > LIMITS.maxImageSide || metadata.width * metadata.height > LIMITS.maxImagePixels) throw new ApiError(413, 'IMAGE_TOO_LARGE', 'Downsample the frame to at most 1280 pixels per side and 1,000,000 pixels in total.');
    const { data, info } = await image.rotate().resize({ width: LIMITS.processedMaxSide, height: LIMITS.processedMaxSide, fit: 'inside', withoutEnlargement: true }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    return { pixels: data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (/pixel limit|exceeds.*pixels/i.test(error.message)) throw new ApiError(413, 'IMAGE_TOO_LARGE', 'The image exceeds the decoded pixel limit.');
    throw new ApiError(400, 'INVALID_IMAGE', 'The JPEG or PNG image could not be decoded.');
  }
}
