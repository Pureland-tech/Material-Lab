/** Token-bucket rate limiter, in memory (one API process). */
export interface Limit {
  /** Burst size. */
  capacity: number;
  /** Tokens added per minute. */
  perMinute: number;
}

export const LIMITS = {
  /** Sign-up and sign-in attempts, per IP. */
  auth: { capacity: 10, perMinute: 10 },
  /** Account reads, per user. */
  read: { capacity: 120, perMinute: 600 },
  /** Account writes, per user. */
  write: { capacity: 60, perMinute: 120 },
  /** Public endpoints (presets, shared links), per IP. */
  public: { capacity: 60, perMinute: 240 },
  /** Server-rendered previews, per IP. */
  preview: { capacity: 15, perMinute: 30 },
  /** AI suggestions, per user (daily quotas are separate). */
  ai: { capacity: 4, perMinute: 6 },
} satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

interface Bucket {
  tokens: number;
  updated: number;
}

const MAX_KEYS = 50_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Take one token. Returns seconds to wait when the bucket is empty. */
  take(name: LimitName, key: string): { ok: true } | { ok: false; retryAfter: number } {
    const limit = LIMITS[name];
    const id = `${name}:${key}`;
    const t = this.now();
    const rate = limit.perMinute / 60_000;
    let bucket = this.buckets.get(id);
    if (!bucket) {
      if (this.buckets.size >= MAX_KEYS) this.sweep(t);
      bucket = { tokens: limit.capacity, updated: t };
      this.buckets.set(id, bucket);
    }
    bucket.tokens = Math.min(limit.capacity, bucket.tokens + (t - bucket.updated) * rate);
    bucket.updated = t;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }
    return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) / rate / 1000)) };
  }

  /** Drop full buckets (idle clients) to bound memory. */
  private sweep(t: number): void {
    for (const [id, bucket] of this.buckets) {
      const name = id.slice(0, id.indexOf(':')) as LimitName;
      const limit = LIMITS[name];
      if (bucket.tokens + (t - bucket.updated) * (limit.perMinute / 60_000) >= limit.capacity) this.buckets.delete(id);
    }
    if (this.buckets.size >= MAX_KEYS) this.buckets.clear();
  }
}
