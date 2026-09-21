import { describe, expect, it } from "vitest";
import { TokenBucket } from "./rate-limiter";

describe("TokenBucket", () => {
  it("lets a burst through immediately, up to its capacity", async () => {
    const bucket = new TokenBucket({ ratePerSecond: 10, burst: 5 });
    const started = Date.now();
    await Promise.all(Array.from({ length: 5 }, () => bucket.acquire()));
    expect(Date.now() - started).toBeLessThan(50);
  });

  it("throttles requests beyond the burst to roughly the configured rate", async () => {
    const bucket = new TokenBucket({ ratePerSecond: 20, burst: 1 });
    await bucket.acquire(); // drains the single burst token
    const started = Date.now();
    await bucket.acquire(); // must wait ~1/20s = 50ms for a refill
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(30);
    expect(elapsed).toBeLessThan(300);
  });
});
