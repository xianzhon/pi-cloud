import { describe, expect, it } from 'vitest';
import { hashPassword, verifyConfiguredPassword } from './password';

// Precomputed for "secret"; verification tests need not generate another hash.
const passwordHash = '$scrypt$ln=15,r=8,p=3$MDEyMzQ1Njc4OWFiY2RlZg==$YX2XUCqlQryHZC93S4JFIOJ4k/YC2h/wCM52bgNcKV4=';

describe('verifyConfiguredPassword', () => {
  it('verifies plain password when no hash is configured', async () => {
    await expect(verifyConfiguredPassword('secret', { password: 'secret' })).resolves.toBe(true);
    await expect(verifyConfiguredPassword('wrong', { password: 'secret' })).resolves.toBe(false);
  });

  it('generates a supported scrypt hash', async () => {
    await expect(hashPassword('secret')).resolves.toMatch(/^\$scrypt\$ln=15,r=8,p=3\$/);
  });

  it('accepts the hashed password even when the plain password differs', async () => {
    await expect(verifyConfiguredPassword('secret', { password: 'wrong', passwordHash })).resolves.toBe(true);
  });

  it('does not fall back to the plain password when a hash is configured', async () => {
    await expect(verifyConfiguredPassword('wrong', { password: 'wrong', passwordHash })).resolves.toBe(false);
  });

  it('rejects malformed and unsupported hashes', async () => {
    await expect(verifyConfiguredPassword('secret', { passwordHash: '$pbkdf2$unsupported' })).resolves.toBe(false);
    await expect(verifyConfiguredPassword('secret', { passwordHash: '$scrypt$ln=15,r=8,p=3$invalid$invalid' })).resolves.toBe(false);
  });
});
