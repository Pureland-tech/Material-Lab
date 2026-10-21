import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { nowIso, type Db } from './db';
import { ApiError } from './http';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

export const PASSWORD_LIMITS = { min: 10, max: 200 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface User {
  id: string;
  email: string;
  name: string;
  plan: string;
  created_at: string;
}

export function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name, plan: user.plan, createdAt: user.created_at };
}

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, , , , saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Verifying against this keeps sign-in timing the same for unknown emails. */
const DUMMY_HASH = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${randomBytes(16).toString('base64')}$${randomBytes(32).toString('base64')}`;

export function validateEmail(raw: unknown): string {
  if (typeof raw !== 'string') throw new ApiError(400, 'invalid_email', 'Enter an email address.');
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new ApiError(400, 'invalid_email', 'Enter a valid email address.');
  return email;
}

export function validatePassword(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length < PASSWORD_LIMITS.min) {
    throw new ApiError(400, 'weak_password', `Use a password of at least ${PASSWORD_LIMITS.min} characters.`);
  }
  if (raw.length > PASSWORD_LIMITS.max) throw new ApiError(400, 'invalid_password', `Passwords can be at most ${PASSWORD_LIMITS.max} characters.`);
  return raw;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** New random identifier with a type prefix. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

/** Unguessable token for links (shares, invites) and sessions. */
export function newToken(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`;
}

export async function createUser(db: Db, input: { email: string; password: string; name: string }): Promise<User> {
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email);
  if (exists) throw new ApiError(409, 'email_taken', 'An account with this email already exists. Sign in instead.');
  const user: User = { id: newId('usr'), email: input.email, name: input.name, plan: 'free', created_at: nowIso() };
  const hash = await hashPassword(input.password);
  db.prepare('INSERT INTO users (id, email, name, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    user.id,
    user.email,
    user.name,
    hash,
    user.plan,
    user.created_at,
  );
  return user;
}

export async function checkCredentials(db: Db, email: string, password: string): Promise<User> {
  const row = db.prepare('SELECT id, email, name, plan, created_at, password_hash FROM users WHERE email = ?').get(email) as
    | (User & { password_hash: string })
    | undefined;
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw new ApiError(401, 'invalid_credentials', 'That email and password do not match an account.');
  const { password_hash: _hash, ...user } = row;
  return user;
}

export function createSession(db: Db, userId: string, days: number): { token: string; expiresAt: string } {
  const token = newToken('mls');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 86_400_000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)').run(
    tokenHash(token),
    userId,
    now.toISOString(),
    expiresAt,
    now.toISOString(),
  );
  return { token, expiresAt };
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m ? (m[1] as string) : null;
}

/** The signed-in user for a bearer token, or null. Expired sessions are removed. */
export function authenticate(db: Db, token: string | null): User | null {
  if (!token || token.length > 200) return null;
  const hash = tokenHash(token);
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.plan, u.created_at, s.expires_at, s.last_used_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(hash) as (User & { expires_at: string; last_used_at: string }) | undefined;
  if (!row) return null;
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  if (now - Date.parse(row.last_used_at) > 3_600_000) {
    db.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').run(new Date(now).toISOString(), hash);
  }
  const { expires_at: _e, last_used_at: _l, ...user } = row;
  return user;
}

export function endSession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}
