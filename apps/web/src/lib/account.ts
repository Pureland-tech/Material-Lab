import { api, apiBase, ApiRequestError, configureSession, type ApiUser, type Entitlements } from './api';
import { track } from './analytics';
import { Observable, useObservable } from './store';

export interface AccountState {
  status: 'signed-out' | 'signed-in';
  user: ApiUser | null;
  entitlements: Entitlements | null;
  /** Shown once after the server ends the session. */
  notice: string | null;
}

const KEY = 'material-lab:session';

interface Stored {
  token: string;
  user: ApiUser;
}

const signedOut: AccountState = { status: 'signed-out', user: null, entitlements: null, notice: null };
export const account = new Observable<AccountState>(signedOut);

function store(value: Stored | null): void {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch {
    // Without storage the session lasts for this tab only.
  }
}

function endLocally(notice: string | null): void {
  store(null);
  configureSession(null, null);
  account.set({ ...signedOut, notice });
}

function begin(token: string, user: ApiUser): void {
  store({ token, user });
  configureSession(token, () => endLocally('Your session ended. Sign in again to keep syncing. Your recipes are still on this device.'));
  account.set({ status: 'signed-in', user, entitlements: null, notice: null });
}

/** Restore a saved session (no network); refreshAccount() checks it with the server. */
export function restoreSession(): void {
  if (!apiBase()) return;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Stored;
    if (typeof saved?.token === 'string' && saved.user?.id) begin(saved.token, saved.user);
  } catch {
    store(null);
  }
}

export async function refreshAccount(): Promise<void> {
  if (account.get().status !== 'signed-in') return;
  try {
    const me = await api<{ user: ApiUser; entitlements: Entitlements }>('GET', '/v1/me');
    account.set({ ...account.get(), user: me.user, entitlements: me.entitlements });
  } catch (error) {
    // Offline: keep the cached session; a 401 already signed out.
    if (!(error instanceof ApiRequestError) || error.status !== 0) throw error;
  }
}

export async function signUp(input: { email: string; password: string; name: string }): Promise<void> {
  const res = await api<{ token: string; user: ApiUser }>('POST', '/v1/auth/signup', { body: input, auth: false });
  begin(res.token, res.user);
  track('account_signed_in', { method: 'signup' });
  await refreshAccount();
}

export async function signIn(input: { email: string; password: string }): Promise<void> {
  const res = await api<{ token: string; user: ApiUser }>('POST', '/v1/auth/login', { body: input, auth: false });
  begin(res.token, res.user);
  track('account_signed_in', { method: 'password' });
  await refreshAccount();
}

/** Sign out here (and optionally on every device). Local recipes stay. */
export async function signOut(everywhere = false): Promise<void> {
  try {
    if (everywhere) await api('DELETE', '/v1/auth/sessions');
    else await api('POST', '/v1/auth/logout');
  } catch {
    // Signing out locally always works, even offline.
  } finally {
    endLocally(null);
  }
}

export async function deleteAccount(password: string): Promise<void> {
  await api('DELETE', '/v1/me', { body: { password } });
  endLocally('Your account and its cloud data were deleted. Recipes on this device were kept.');
}

export function clearNotice(): void {
  account.set({ ...account.get(), notice: null });
}

export function useAccount(): AccountState {
  return useObservable(account);
}
