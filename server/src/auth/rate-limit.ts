interface RateLimiterOptions {
  maxFailures: number;
  windowMs: number;
  maxTrackedIps?: number;
  now?: () => number;
}

const DEFAULT_MAX_TRACKED_IPS = 10_000;

export class IpRateLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(private options: RateLimiterOptions) {
    this.now = options.now || Date.now;
  }

  isBlocked(ip: string): boolean {
    return this.activeFailures(ip).length >= this.options.maxFailures;
  }

  recordFailure(ip: string): void {
    const failures = this.activeFailures(ip);
    failures.push(this.now());
    this.failures.set(ip, failures);
    if (this.failures.size > (this.options.maxTrackedIps ?? DEFAULT_MAX_TRACKED_IPS)) this.prune();
  }

  recordSuccess(ip: string): void {
    this.failures.delete(ip);
  }

  get trackedIpCount(): number {
    return this.failures.size;
  }

  private activeFailures(ip: string): number[] {
    const cutoff = this.now() - this.options.windowMs;
    const active = (this.failures.get(ip) || []).filter((timestamp) => timestamp > cutoff);
    if (active.length) this.failures.set(ip, active);
    else this.failures.delete(ip);
    return active;
  }

  // Bound memory when many distinct addresses fail: drop expired entries, then the oldest.
  private prune(): void {
    for (const ip of this.failures.keys()) this.activeFailures(ip);
    const limit = this.options.maxTrackedIps ?? DEFAULT_MAX_TRACKED_IPS;
    for (const ip of this.failures.keys()) {
      if (this.failures.size <= limit) break;
      this.failures.delete(ip);
    }
  }
}
