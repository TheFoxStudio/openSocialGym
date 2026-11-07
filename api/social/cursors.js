import crypto from 'node:crypto';
import { SocialError } from './errors.js';

// Opaque, authenticated cursors avoid exposing a community-wide sequence counter.
// They are only pagination hints; every page still applies the current access policy.
export function createCursorCodec(key, now = Date.now) {
  const bytes = Buffer.from(key, 'hex');
  return {
    encode(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', bytes, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify({ ...value, expires: now() + 3600000 })), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
    },
    decode(cursor, context) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 1000) throw Error();
        const data = Buffer.from(cursor, 'base64url');
        const decipher = crypto.createDecipheriv('aes-256-gcm', bytes, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(12, 28));
        const value = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
        if (value.context !== context || !Number.isFinite(value.expires) || value.expires < now()) throw Error();
        return value;
      } catch { throw new SocialError(400, 'cursor-invalid', 'Reload this list to continue.'); }
    }
  };
}
