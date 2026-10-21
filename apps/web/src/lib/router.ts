import { useSyncExternalStore } from 'react';

export const ROUTES = ['home', 'explore', 'create', 'recipes', 'exports', 'settings', 'account', 'teams', 'shared', 'invite'] as const;
export type RouteName = (typeof ROUTES)[number];

export interface Route {
  name: RouteName;
  params: URLSearchParams;
  /** Second path segment, e.g. the token in #/shared/<token>. */
  id: string | null;
}

function parse(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [first = '', second] = path.split('/');
  const name = (ROUTES as readonly string[]).includes(first) ? (first as RouteName) : 'home';
  let id: string | null = null;
  try {
    id = second ? decodeURIComponent(second) : null;
  } catch {
    id = null;
  }
  return { name, params: new URLSearchParams(query), id };
}

let current = typeof location === 'undefined' ? parse('') : parse(location.hash);
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parse(location.hash);
    for (const l of listeners) l();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

export function routeHref(name: RouteName, params?: Record<string, string>, id?: string): string {
  const path = name === 'home' ? '' : id ? `${name}/${encodeURIComponent(id)}` : name;
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  return `#/${path}${query}`;
}

export function navigate(name: RouteName, params?: Record<string, string>, id?: string): void {
  const href = routeHref(name, params, id);
  if (location.hash === href || (href === '#/' && location.hash === '')) return;
  location.hash = href;
}
