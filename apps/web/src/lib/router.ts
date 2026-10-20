import { useSyncExternalStore } from 'react';

export const ROUTES = ['home', 'explore', 'create', 'recipes', 'exports', 'settings'] as const;
export type RouteName = (typeof ROUTES)[number];

export interface Route {
  name: RouteName;
  params: URLSearchParams;
}

function parse(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const name = (ROUTES as readonly string[]).includes(path) ? (path as RouteName) : 'home';
  return { name, params: new URLSearchParams(query) };
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

export function routeHref(name: RouteName, params?: Record<string, string>): string {
  const path = name === 'home' ? '' : name;
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  return `#/${path}${query}`;
}

export function navigate(name: RouteName, params?: Record<string, string>): void {
  const href = routeHref(name, params);
  if (location.hash === href || (href === '#/' && location.hash === '')) return;
  location.hash = href;
}
