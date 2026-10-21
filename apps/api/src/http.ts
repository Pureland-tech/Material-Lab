import type { IncomingMessage, ServerResponse } from 'node:http';

/** An error with a stable code and a message that is safe to show users. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what = 'Not found', code = 'not_found') => new ApiError(404, code, what);
export const badRequest = (message: string, code = 'invalid_request', details?: Record<string, unknown>) => new ApiError(400, code, message, details);

export interface Reply {
  status?: number;
  body?: unknown;
  /** Raw bytes (e.g. PNG); `body` is ignored when set. */
  raw?: Uint8Array;
  contentType?: string;
  headers?: Record<string, string>;
}

/** Endpoints readable from any origin without credentials (presets, shared links). */
export type CorsMode = 'app' | 'public';

export interface Request {
  method: string;
  url: URL;
  /** Route pattern that matched, e.g. /v1/recipes/:recipeId — logged instead of the raw path. */
  route: string;
  params: Record<string, string>;
  ip: string;
  headers: IncomingMessage['headers'];
  body: () => Promise<unknown>;
}

export type Handler = (req: Request) => Promise<Reply> | Reply;

interface Route {
  method: string;
  pattern: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
  cors: CorsMode;
}

const MAX_PARAM_LENGTH = 128;

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, options: { cors?: CorsMode } = {}): this {
    const keys: string[] = [];
    const source = pattern
      .split('/')
      .map((part) => {
        if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        keys.push(part.slice(1));
        return '([^/]+)';
      })
      .join('/');
    this.routes.push({ method, pattern, regex: new RegExp(`^${source}$`), keys, handler, cors: options.cors ?? 'app' });
    return this;
  }

  /** The route for a request; `allowed` lists methods when the path exists but the method does not. */
  match(method: string, path: string): { route: Route; params: Record<string, string> } | { route: null; allowed: string[] } {
    const allowed: string[] = [];
    for (const route of this.routes) {
      const m = route.regex.exec(path);
      if (!m) continue;
      if (route.method !== method) {
        allowed.push(route.method);
        continue;
      }
      const params: Record<string, string> = {};
      for (const [i, key] of route.keys.entries()) {
        let value: string;
        try {
          value = decodeURIComponent(m[i + 1] as string);
        } catch {
          throw badRequest('Malformed URL.');
        }
        if (value.length > MAX_PARAM_LENGTH) throw badRequest('URL parameter is too long.');
        params[key] = value;
      }
      return { route, params };
    }
    return { route: null, allowed };
  }

  /** CORS mode for a path regardless of method (for preflight requests). */
  corsFor(path: string): CorsMode | null {
    const route = this.routes.find((r) => r.regex.test(path));
    return route ? route.cors : null;
  }
}

/** Read a JSON body up to `limit` bytes. */
export async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json\b/i.test(type)) throw new ApiError(415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json.');
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new ApiError(413, 'payload_too_large', `Request body is larger than ${Math.round(limit / 1024)} KB.`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ApiError(413, 'payload_too_large', `Request body is larger than ${Math.round(limit / 1024)} KB.`);
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw badRequest('Request body is not valid JSON.', 'invalid_json');
  }
}

export function send(res: ServerResponse, reply: Reply): void {
  const status = reply.status ?? (reply.body === undefined && !reply.raw ? 204 : 200);
  for (const [k, v] of Object.entries(reply.headers ?? {})) res.setHeader(k, v);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (reply.raw) {
    res.writeHead(status, { 'Content-Type': reply.contentType ?? 'application/octet-stream', 'Content-Length': reply.raw.length });
    res.end(reply.raw);
    return;
  }
  if (status === 204 || reply.body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const json = JSON.stringify(reply.body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': res.getHeader('Cache-Control') ?? 'no-store' });
  res.end(json);
}

export function errorBody(error: ApiError): { error: { code: string; message: string } & Record<string, unknown> } {
  return { error: { code: error.code, message: error.message, ...(error.details ?? {}) } };
}

// --- Small validation helpers -------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw badRequest('Request body must be a JSON object.');
  return value;
}

export function stringField(body: Record<string, unknown>, key: string, options: { min?: number; max: number; optional?: boolean; label?: string }): string | undefined {
  const value = body[key];
  const label = options.label ?? key;
  if (value === undefined || value === null) {
    if (options.optional) return undefined;
    throw badRequest(`${label} is required.`, 'invalid_request', { field: key });
  }
  if (typeof value !== 'string') throw badRequest(`${label} must be text.`, 'invalid_request', { field: key });
  const trimmed = value.trim();
  if (trimmed.length < (options.min ?? 1)) throw badRequest(`${label} is too short.`, 'invalid_request', { field: key });
  if (trimmed.length > options.max) throw badRequest(`${label} must be at most ${options.max} characters.`, 'invalid_request', { field: key });
  return trimmed;
}

export function intField(body: Record<string, unknown>, key: string, options: { min: number; max: number; optional?: boolean }): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    if (options.optional) return undefined;
    throw badRequest(`${key} is required.`, 'invalid_request', { field: key });
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < options.min || value > options.max) {
    throw badRequest(`${key} must be a whole number from ${options.min} to ${options.max}.`, 'invalid_request', { field: key });
  }
  return value;
}
