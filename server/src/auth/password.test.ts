import { describe, expect, it } from 'vitest';
import { hashPassword, verifyConfiguredPassword } from './password';

describe('verifyConfiguredPassword', () => {
  it('verifies plain password when no hash is configured', async () => {
    await expect(verifyConfiguredPassword('secret', { password: 'secret' })).resolves.toBe(true);
    await expect(verifyConfiguredPassword('wrong', { password: 'secret' })).resolves.toBe(false);
  });

  it('prefers scrypt hash over plain password', async () => {
    const hash = await hashPassword('secret');
    expect(hash).toMatch(/^\$scrypt\$ln=15,r=8,p=3\$/);
    await expect(verifyConfiguredPassword('secret', { password: 'wrong', passwordHash: hash })).resolves.toBe(true);
    await expect(verifyConfiguredPassword('wrong', { password: 'secret', passwordHash: hash })).resolves.toBe(false);
  });

  it('rejects malformed and unsupported hashes', async () => {
    await expect(verifyConfiguredPassword('secret', { passwordHash: '$pbkdf2$unsupported' })).resolves.toBe(false);
    await expect(verifyConfiguredPassword('secret', { passwordHash: '$scrypt$ln=15,r=8,p=3$invalid$invalid' })).resolves.toBe(false);
  });
});
