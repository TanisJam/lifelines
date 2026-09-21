/**
 * A token-bucket rate limiter (round 11, decision 044). Jev's sustained limit is 1,200
 * requests/min and 250k tokens/s (docs/findings.md "Jev throughput limits"); a 200-request burst
 * is fine. This limiter is request-based (one token per request), configurable, and defaults well
 * under the documented sustained limit (18 req/s ≈ 1,080 req/min) so a run shares headroom with
 * whatever else is calling the same account.
 */
export interface TokenBucketOptions {
  /** Steady-state tokens (requests) refilled per second. */
  readonly ratePerSecond: number;
  /** Maximum tokens the bucket can hold, i.e. the largest instantaneous burst allowed. */
  readonly burst: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(private readonly options: TokenBucketOptions) {
    this.tokens = options.burst;
    this.lastRefillMs = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = Math.max(0, now - this.lastRefillMs) / 1000;
    this.tokens = Math.min(this.options.burst, this.tokens + elapsedSeconds * this.options.ratePerSecond);
    this.lastRefillMs = now;
  }

  /** Resolves once a token is available, consuming it. Waits (without busy-looping) when the bucket is empty. */
  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      const waitMs = Math.max(1, (deficit / this.options.ratePerSecond) * 1000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/** Default sustained rate (requests/s) — conservative relative to the documented 1,200/min limit. */
export const DEFAULT_RATE_PER_SECOND = 18;
/** Default burst size — the docs report 200 parallel requests bursting fine; kept a bit under that. */
export const DEFAULT_BURST = 100;
