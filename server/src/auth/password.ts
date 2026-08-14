import argon2 from 'argon2';
import { timingSafeEqual } from 'crypto';

interface PasswordConfig {
  password?: string;
  passwordHash?: string;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function verifyConfiguredPassword(candidate: string, config: PasswordConfig): Promise<boolean> {
  if (config.passwordHash) {
    try {
      return await argon2.verify(config.passwordHash, candidate);
    } catch {
      return false;
    }
  }

  if (!config.password) return false;
  return safeEqual(candidate, config.password);
}
