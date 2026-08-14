interface RateLimiterOptions {
  maxFailures: number;
  windowMs: number;
  now?: () => number;
}

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
  }

  recordSuccess(ip: string): void {
    this.failures.delete(ip);
  }

  private activeFailures(ip: string): number[] {
    const cutoff = this.now() - this.options.windowMs;
    const active = (this.failures.get(ip) || []).filter((timestamp) => timestamp > cutoff);
    this.failures.set(ip, active);
    return active;
  }
}
