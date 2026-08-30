import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';

interface WecomSignatureInput {
  token: string;
  timestamp: string;
  nonce: string;
  encrypted: string;
  signature: string;
}

export function verifyWecomSignature(input: WecomSignatureInput): boolean {
  const expected = createHash('sha1')
    .update([input.token, input.timestamp, input.nonce, input.encrypted].sort().join(''))
    .digest();
  if (!/^[0-9a-f]{40}$/i.test(input.signature)) return false;
  const actual = Buffer.from(input.signature, 'hex');
  return timingSafeEqual(expected, actual);
}

export function decryptWecomPayload(encrypted: string, encodingAesKey: string, expectedReceiveId: string): string {
  const key = parseEncodingAesKey(encodingAesKey);
  const ciphertext = Buffer.from(encrypted, 'base64');
  if (!ciphertext.length || ciphertext.length % 16 !== 0) throw new Error('Invalid WeCom encrypted payload');

  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const plaintext = removePkcs7Padding(padded);
  if (plaintext.length < 20) throw new Error('Invalid WeCom decrypted payload');

  const messageLength = plaintext.readUInt32BE(16);
  const messageStart = 20;
  const messageEnd = messageStart + messageLength;
  if (messageEnd > plaintext.length) throw new Error('Invalid WeCom message length');

  const receiveId = plaintext.subarray(messageEnd).toString('utf8');
  if (receiveId !== expectedReceiveId) throw new Error('Invalid WeCom callback receive ID');
  return plaintext.subarray(messageStart, messageEnd).toString('utf8');
}

function parseEncodingAesKey(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}$/.test(value)) throw new Error('WeCom EncodingAESKey must contain 43 base64 characters');
  const key = Buffer.from(`${value}=`, 'base64');
  if (key.length !== 32) throw new Error('Invalid WeCom EncodingAESKey');
  return key;
}

function removePkcs7Padding(value: Buffer): Buffer {
  const padding = value[value.length - 1];
  if (!padding || padding > 32 || padding > value.length) throw new Error('Invalid WeCom PKCS#7 padding');
  for (let index = value.length - padding; index < value.length; index += 1) {
    if (value[index] !== padding) throw new Error('Invalid WeCom PKCS#7 padding');
  }
  return value.subarray(0, value.length - padding);
}
