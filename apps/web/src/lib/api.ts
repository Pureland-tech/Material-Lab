import { getSettings } from './settings';

/** An error from the account server, with its stable code and a user-safe message. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** The account server URL, or null when this build has none (local-only). */
export function apiBase(): string | null {
  const configured = getSettings().serverUrl ?? (import.meta.env.VITE_API_URL as string | undefined) ?? null;
  return configured ? configured.replace(/\/+$/, '') : null;
}

let sessionToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Set by the account module: the bearer token and what to do when the session ends. */
export function configureSession(token: string | null, unauthorized: (() => void) | null): void {
  sessionToken = token;
  onUnauthorized = unauthorized;
}

export interface ApiOptions {
  body?: unknown;
  signal?: AbortSignal;
  /** Send the session token (default true when signed in). */
  auth?: boolean;
}

export async function api<T>(method: string, path: string, options: ApiOptions = {}): Promise<T> {
  const base = apiBase();
  if (!base) throw new ApiRequestError(0, 'not_configured', 'This version of Material Lab is not connected to an account server.');
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const useAuth = options.auth ?? true;
  if (useAuth && sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiRequestError(0, 'network', 'Could not reach the Material Lab server. Check your connection and try again.');
  }
  if (res.status === 204 || res.status === 304) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON error page from a proxy.
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } & Record<string, unknown> } | null)?.error;
    if (res.status === 401 && useAuth && sessionToken) onUnauthorized?.();
    const { code, message, ...details } = err ?? {};
    throw new ApiRequestError(res.status, code ?? `http_${res.status}`, message ?? `The server returned an error (${res.status}).`, details);
  }
  return data as T;
}

/** Absolute URL for a server path (e.g. a share preview image). */
export function apiUrl(path: string): string | null {
  const base = apiBase();
  return base ? base + path : null;
}

// --- Shapes returned by the API ------------------------------------------------

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  plan: string;
  createdAt: string;
}

export interface Entitlements {
  plan: string;
  planLabel: string;
  limits: { cloudRecipes: number; ownedTeams: number; teamMembers: number; aiSuggestionsPerDay: number };
  usage: { cloudRecipes: number; ownedTeams: number; aiSuggestionsToday: number };
  features: { cloudSync: boolean; shareLinks: boolean; teams: boolean; aiSuggestions: boolean };
}

export interface CloudRecipe {
  recipeId: string;
  name: string;
  family: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  recipe?: import('@material-lab/engine').Recipe;
  teamId?: string;
  folderId?: string | null;
  createdBy?: { id: string; name: string } | null;
  updatedBy?: { id: string; name: string } | null;
  approval?: { approvedVersion: number; current: boolean; approvedBy: { id: string; name: string } | null; approvedAt: string } | null;
}

export interface ShareLink {
  id: string;
  access: 'view' | 'duplicate';
  status: 'active' | 'revoked' | 'expired';
  url: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
}
