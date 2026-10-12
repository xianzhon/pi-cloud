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

  it('does not track addresses that have no recent failures', () => {
    let now = 1_000;
    const limiter = new IpRateLimiter({ maxFailures: 2, windowMs: 60_000, now: () => now });
    limiter.isBlocked('1.2.3.4');
    expect(limiter.trackedIpCount).toBe(0);
    limiter.recordFailure('1.2.3.4');
    now += 61_000;
    limiter.isBlocked('1.2.3.4');
    expect(limiter.trackedIpCount).toBe(0);
  });

  it('bounds the number of tracked addresses', () => {
    const limiter = new IpRateLimiter({ maxFailures: 2, windowMs: 60_000, maxTrackedIps: 3 });
    for (let index = 0; index < 10; index++) limiter.recordFailure(`10.0.0.${index}`);
    expect(limiter.trackedIpCount).toBe(3);
    expect(limiter.isBlocked('10.0.0.9')).toBe(false);
    limiter.recordFailure('10.0.0.9');
    expect(limiter.isBlocked('10.0.0.9')).toBe(true);
  });

  it('clears failures after success', () => {
    const limiter = new IpRateLimiter({ maxFailures: 2, windowMs: 60_000 });
    limiter.recordFailure('1.2.3.4');
    limiter.recordSuccess('1.2.3.4');
    limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
  });
});
