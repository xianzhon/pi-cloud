import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';
import { verifyConfiguredPassword } from './password';

describe('verifyConfiguredPassword', () => {
  it('verifies plain password when no hash is configured', async () => {
    await expect(verifyConfiguredPassword('secret', { password: 'secret' })).resolves.toBe(true);
    await expect(verifyConfiguredPassword('wrong', { password: 'secret' })).resolves.toBe(false);
  });

  it('prefers argon2 hash over plain password', async () => {
    const hash = await argon2.hash('secret');
    await expect(verifyConfiguredPassword('secret', { password: 'wrong', passwordHash: hash })).resolves.toBe(true);
    await expect(verifyConfiguredPassword('wrong', { password: 'secret', passwordHash: hash })).resolves.toBe(false);
  });
});
