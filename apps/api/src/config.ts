export interface Config {
  port: number;
  host: string;
  /** SQLite file, or ':memory:' (tests). */
  databasePath: string;
  /** Browser origins allowed to call account endpoints (CORS). */
  allowedOrigins: string[];
  /** Web app URL used to build share and invite links. */
  publicWebUrl: string;
  /** Use X-Forwarded-For for client IPs (only behind a trusted proxy). */
  trustProxy: boolean;
  sessionDays: number;
  ai: {
    /** Call Claude for suggestions; when off, the built-in keyword matcher answers. */
    enabled: boolean;
    model: string;
    effort: 'low' | 'medium' | 'high';
    timeoutMs: number;
  };
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const aiSetting = (env.MATERIAL_LAB_AI ?? 'auto').toLowerCase();
  const hasCredentials = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const effort = env.MATERIAL_LAB_AI_EFFORT;
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '127.0.0.1',
    databasePath: env.DATABASE_PATH ?? 'data/material-lab.db',
    allowedOrigins: list(env.ALLOWED_ORIGINS, ['http://localhost:5173', 'http://localhost:4173']),
    publicWebUrl: (env.PUBLIC_WEB_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),
    trustProxy: env.TRUST_PROXY === '1',
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    ai: {
      // "auto": on when API credentials are present; "on" also allows other
      // credential sources (e.g. an `ant auth login` profile); "off" never calls out.
      enabled: aiSetting === 'on' || (aiSetting === 'auto' && hasCredentials),
      model: env.MATERIAL_LAB_AI_MODEL ?? 'claude-opus-5-5',
      effort: effort === 'medium' || effort === 'high' ? effort : 'low',
      timeoutMs: Number(env.MATERIAL_LAB_AI_TIMEOUT_MS ?? 45_000),
    },
  };
}
