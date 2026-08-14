import { createDecipheriv } from 'node:crypto';

export function parseWeixinAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, 'base64');
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex');
  }
  throw new Error(`WeChat media aes_key must decode to 16 raw bytes or 32 hex bytes, got ${decoded.length} bytes.`);
}

export function decryptWeixinMedia(ciphertext: Buffer, key: Buffer): Buffer {
  if (key.length !== 16) throw new Error(`WeChat media AES key must be 16 bytes, got ${key.length}.`);
  const decipher = createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function buildWeixinCdnDownloadUrl(encryptedQueryParam: string): string {
  return `https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}
