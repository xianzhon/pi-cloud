import { describe, expect, it } from 'vitest';
import { decryptWecomPayload, verifyWecomSignature } from './wecom-crypto.js';

const ENCODING_AES_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const ENCRYPTED_TEXT_MESSAGE = 'Ikwn9Lo3iyfT1oiK3O1kQsS2eFwvWAV3H7XQF0PkQrTfQG2EwsdUlVR9j4jlcMpHNCVATbc+NVm0Fhmdn9twq63/PFc1RgPjfF+NhqeiiZdgsDasg5b4bIAeX96+Pr7+rRwOIL/KdclNrjryfjgRPw4XoX8byWcMlLfYTjTfWZKd24VbLXqbfZLOFXv1nJs2kcavgaWzUDdeLPnRUar6ofeqKUYuaGRUFuB4osceHY63HUD8D4gcajL5Nn/lhbIYRd4zETfk5X7aj0u7ktyTKs4S0qrW/TtbCD254UNIyNR0sACvm+/Rg3Bk7y+DuMqs+lV66Tq52BjwWagG6T033BG9wW+wbrd/oVzQcJk4VdhH+eTZuyQrCth2Y7Gjte/k';

describe('WeCom callback crypto', () => {
  it('validates the documented sorted SHA-1 callback signature', () => {
    expect(verifyWecomSignature({
      token: 'callback-token',
      timestamp: '1788100000',
      nonce: 'nonce-test',
      encrypted: ENCRYPTED_TEXT_MESSAGE,
      signature: 'abb7f19df3f3a4630fd721ae1f2d3464991df92f',
    })).toBe(true);

    expect(verifyWecomSignature({
      token: 'callback-token',
      timestamp: '1788100000',
      nonce: 'nonce-test',
      encrypted: ENCRYPTED_TEXT_MESSAGE,
      signature: '0000000000000000000000000000000000000000',
    })).toBe(false);
  });

  it('decrypts a callback and verifies its receive ID', () => {
    expect(decryptWecomPayload(ENCRYPTED_TEXT_MESSAGE, ENCODING_AES_KEY, 'corp-test')).toBe(
      '<xml><ToUserName><![CDATA[corp-test]]></ToUserName><FromUserName><![CDATA[user-1]]></FromUserName><CreateTime>1788100000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hello]]></Content><MsgId>12345</MsgId><AgentID>1000002</AgentID></xml>',
    );

    expect(() => decryptWecomPayload(ENCRYPTED_TEXT_MESSAGE, ENCODING_AES_KEY, 'other-corp')).toThrow('receive ID');
  });
});
