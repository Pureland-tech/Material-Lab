import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createClaudeSuggester, type Suggester } from './ai';
import type { Config } from './config';
import type { Services } from './context';
import { openDatabase, type Db } from './db';
import { ApiError, errorBody, readJson, Router, send, type CorsMode } from './http';
import { RateLimiter } from './rate-limit';
import { registerAccountRoutes } from './routes/account';
import { registerAssistantRoutes } from './routes/assistant';
import { registerPublicRoutes } from './routes/public';
import { registerRecipeRoutes } from './routes/recipes';
import { registerShareRoutes } from './routes/shares';
import { registerTeamRoutes } from './routes/teams';

/** Request bodies: a recipe (≤ 256 KB) plus envelope. */
const BODY_LIMIT = 300 * 1024;

export interface App {
  server: Server;
  db: Db;
  services: Services;
  close(): Promise<void>;
}

export interface AppOptions {
  /** Override the AI suggester (tests); `null` disables AI. Defaults to Claude when enabled in config. */
  suggester?: Suggester | null;
  /** Called once per request after the response, e.g. for logging. */
  onRequest?: (entry: { method: string; route: string; status: number; ms: number }) => void;
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function applyCors(req: IncomingMessage, res: ServerResponse, mode: CorsMode | null, allowed: readonly string[]): void {
  const origin = req.headers.origin;
  if (!origin || !mode) return;
  // Bearer tokens (not cookies) authenticate, so no credentials mode is needed.
  if (mode === 'public') res.setHeader('Access-Control-Allow-Origin', '*');
  else if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else return;
  res.setHeader('Access-Control-Expose-Headers', 'ETag, Retry-After');
}

export function createApp(config: Config, options: AppOptions = {}): App {
  const db = openDatabase(config.databasePath);
  const suggester = options.suggester !== undefined ? options.suggester : config.ai.enabled ? createClaudeSuggester(config.ai) : null;
  const services: Services = { db, config, limiter: new RateLimiter(), suggester };
  const router = new Router();
  registerPublicRoutes(router, services);
  registerAccountRoutes(router, services);
  registerRecipeRoutes(router, services);
  registerShareRoutes(router, services);
  registerTeamRoutes(router, services);
  registerAssistantRoutes(router, services);

  const server = createServer(async (req, res) => {
    const start = performance.now();
    const method = req.method ?? 'GET';
    let route = 'unmatched';
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      send(res, { status: 400, body: errorBody(new ApiError(400, 'invalid_request', 'Malformed URL.')) });
      return;
    }
    res.on('finish', () => options.onRequest?.({ method, route, status: res.statusCode, ms: performance.now() - start }));
    try {
      applyCors(req, res, router.corsFor(url.pathname), config.allowedOrigins);
      if (method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match, If-None-Match');
        res.setHeader('Access-Control-Max-Age', '600');
        send(res, { status: 204 });
        return;
      }
      const match = router.match(method, url.pathname);
      if (!match.route) {
        if (match.allowed.length > 0) throw new ApiError(405, 'method_not_allowed', 'This endpoint does not support that method.', undefined, { Allow: match.allowed.join(', ') });
        throw new ApiError(404, 'not_found', 'No such endpoint.');
      }
      route = match.route.pattern;
      const reply = await match.route.handler({
        method,
        url,
        route,
        params: match.params,
        ip: clientIp(req, config.trustProxy),
        headers: req.headers,
        body: () => readJson(req, BODY_LIMIT),
      });
      send(res, reply);
    } catch (error) {
      if (error instanceof ApiError) {
        send(res, { status: error.status, body: errorBody(error), headers: error.headers });
        return;
      }
      // Never echo internal errors (or anything from the request) to clients or logs verbatim.
      console.error(`[api] ${method} ${route} failed:`, error instanceof Error ? error.stack : error);
      send(res, { status: 500, body: errorBody(new ApiError(500, 'internal_error', 'Something went wrong on our side. Please try again.')) });
    }
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;

  return {
    server,
    db,
    services,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
