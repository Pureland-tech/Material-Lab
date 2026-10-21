import type { Suggester } from './ai';
import { authenticate, bearerToken, type User } from './auth';
import type { Config } from './config';
import type { Db } from './db';
import { ApiError, type Request } from './http';
import type { RateLimiter, LimitName } from './rate-limit';

export interface Services {
  db: Db;
  config: Config;
  limiter: RateLimiter;
  /** Null when AI is off: suggestions come from the built-in matcher. */
  suggester: Suggester | null;
}

export function limit(s: Services, name: LimitName, key: string): void {
  const result = s.limiter.take(name, key);
  if (!result.ok) {
    throw new ApiError(429, 'rate_limited', 'Too many requests. Please wait a moment and try again.', { retryAfter: result.retryAfter }, {
      'Retry-After': String(result.retryAfter),
    });
  }
}

/** The signed-in user (401 otherwise), rate limited per user for reads or writes. */
export function requireUser(s: Services, req: Request): User {
  const token = bearerToken(req.headers.authorization);
  const user = authenticate(s.db, token);
  if (!user) throw new ApiError(401, 'unauthenticated', token ? 'Your session has ended. Sign in again.' : 'Sign in to use this feature.');
  limit(s, req.method === 'GET' ? 'read' : 'write', user.id);
  return user;
}
