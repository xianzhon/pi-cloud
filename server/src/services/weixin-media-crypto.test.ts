import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptWeixinMedia, parseWeixinAesKey } from './weixin-media-crypto.js';

describe('parseWeixinAesKey', () => {
  it('parses base64 encoded raw 16-byte keys', () => {
    const key = randomBytes(16);
    expect(parseWeixinAesKey(key.toString('base64'))).toEqual(key);
  });

  it('parses base64 encoded 32-character hex keys', () => {
    expect(parseWeixinAesKey(Buffer.from('00112233445566778899aabbccddeeff').toString('base64'))).toEqual(Buffer.from('00112233445566778899aabbccddeeff', 'hex'));
  });
});

describe('decryptWeixinMedia', () => {
  it('decrypts AES-128-ECB media ciphertext with PKCS padding', () => {
    const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const plaintext = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4]);
    const cipher = createCipheriv('aes-128-ecb', key, null);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    expect(decryptWeixinMedia(ciphertext, key)).toEqual(plaintext);
  });
});
