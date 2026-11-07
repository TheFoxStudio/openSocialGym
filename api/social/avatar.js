import sharp from 'sharp';
import { sniffMedia } from '../media.js';
import { SocialError } from './errors.js';

export const AVATAR_INPUT_MAX = 2 * 1024 * 1024;
sharp.cache({ memory: 8, files: 0, items: 16 });
sharp.concurrency(1);
let processing = false;
export const processAvatar = bytes => processImage(bytes, false);
export const processPostPhoto = bytes => processImage(bytes, true);
async function processImage(bytes, post) {
  if (!bytes.length || bytes.length > AVATAR_INPUT_MAX) throw new SocialError(413, 'avatar-too-large', 'Choose a photo smaller than 2 MiB.');
  const type = sniffMedia(bytes.subarray(0, 64));
  if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type.mime)) throw new SocialError(415, 'avatar-type', 'Choose a JPEG, PNG or WebP photo.');
  if (processing) throw new SocialError(503, 'avatar-busy', 'An image is being processed. Try again shortly.');
  processing = true;
  try {
    const image = sharp(bytes, { limitInputPixels: 4 * 1000 * 1000, failOn: 'warning', animated: false }).timeout({ seconds: 5 });
    const meta = await image.metadata();
    if ((meta.pages || 1) !== 1) throw new Error('animated image');
    // Re-encoding drops metadata by default. Never call keepMetadata/withMetadata here.
    return await image.rotate().resize(post ? { width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true } : { width: 512, height: 512, fit: 'cover' }).webp({ quality: 80 }).toBuffer();
  } catch {
    throw new SocialError(400, 'avatar-invalid', 'This photo could not be read. Choose another photo.');
  } finally { processing = false; }
}

// Bound both the collected body and its lifetime. Drain a refused body so the 413 can arrive.
export function readAvatar(req) {
  return new Promise((resolve, reject) => {
    let size = 0, settled = false;
    const chunks = [];
    const finish = (error, bytes) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { chunks.length = 0; reject(error); } else resolve(bytes);
    };
    const timer = setTimeout(() => finish(new SocialError(408, 'avatar-timeout', 'Photo upload timed out.')), 15000);
    req.on('data', chunk => {
      size += chunk.length;
      if (size > AVATAR_INPUT_MAX) finish(new SocialError(413, 'avatar-too-large', 'Choose a photo smaller than 2 MiB.'));
      if (!settled) chunks.push(chunk);
      if (size > 2 * AVATAR_INPUT_MAX) req.destroy();
    });
    req.on('end', () => finish(null, Buffer.concat(chunks)));
    req.on('error', () => finish(new SocialError(400, 'avatar-upload', 'Photo upload failed.')));
    req.on('aborted', () => finish(new SocialError(400, 'avatar-upload', 'Photo upload failed.')));
  });
}
