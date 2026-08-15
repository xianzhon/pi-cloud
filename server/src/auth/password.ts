import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

interface PasswordConfig {
  password?: string;
  passwordHash?: string;
}

const SCRYPT_KEY_LENGTH = 32;
// OWASP's recommended scrypt work factor balances memory hardness with login latency.
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 } as const;
const SCRYPT_PREFIX = '$scrypt$ln=15,r=8,p=3$';
const SCRYPT_HASH_PATTERN = /^\$scrypt\$ln=15,r=8,p=3\$([A-Za-z0-9+/]{22}==)\$([A-Za-z0-9+/]{43}=)$/;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const left = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const right = Buffer.isBuffer(b) ? b : Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `${SCRYPT_PREFIX}${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyConfiguredPassword(candidate: string, config: PasswordConfig): Promise<boolean> {
  if (config.passwordHash) {
    const match = SCRYPT_HASH_PATTERN.exec(config.passwordHash);
    if (!match) return false;

    try {
      const actual = await deriveKey(candidate, Buffer.from(match[1], 'base64'));
      return safeEqual(actual, Buffer.from(match[2], 'base64'));
    } catch {
      return false;
    }
  }

  if (!config.password) return false;
  return safeEqual(candidate, config.password);
}
