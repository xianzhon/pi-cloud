import { describe, expect, it } from 'vitest';
import { IpRateLimiter } from './rate-limit';

describe('IpRateLimiter', () => {
  it('blocks an IP after max failures in the window', () => {
    let now = 1_000;
    const limiter = new IpRateLimiter({ maxFailures: 2, windowMs: 60_000, now: () => now });

    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
    limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
    limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(true);

    now += 61_000;
    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
  });

  it('clears failures after success', () => {
    const limiter = new IpRateLimiter({ maxFailures: 2, windowMs: 60_000 });
    limiter.recordFailure('1.2.3.4');
    limiter.recordSuccess('1.2.3.4');
    limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
  });
});
