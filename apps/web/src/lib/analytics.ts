/**
 * Product analytics, privacy-first.
 *
 * Events carry only coarse, non-identifying properties (ids of built-in
 * presets, counts, durations, status codes) — never generated images, full
 * recipes, recipe names or parameter values. In this build events stay on
 * the device: they are kept in a small in-memory log (visible under
 * Settings → Privacy) and no transport is configured.
 */
import { Observable } from './store';

export type EventName =
  | 'material_lab_opened'
  | 'preset_browser_opened'
  | 'preset_selected'
  | 'recipe_created'
  | 'recipe_reopened'
  | 'layer_added'
  | 'layer_operation'
  | 'parameter_changed'
  | 'preview_render_completed'
  | 'variation_generation_started'
  | 'variation_selected'
  | 'recipe_saved'
  | 'recipe_save_failed'
  | 'recipe_imported'
  | 'export_started'
  | 'export_completed'
  | 'export_failed'
  | 'auth_prompt_opened'
  | 'account_signed_in'
  | 'sync_status_changed'
  | 'share_link_created'
  | 'shared_recipe_opened'
  | 'team_created'
  | 'suggestion_requested'
  | 'suggestion_opened';

export type EventProps = Record<string, string | number | boolean>;

export interface TrackedEvent {
  name: EventName;
  props: EventProps;
  at: string;
}

const MAX_EVENTS = 200;
export const eventLog = new Observable<TrackedEvent[]>([]);

/** Optional transport, e.g. a first-party endpoint added later with user consent. */
type Transport = (event: TrackedEvent) => void;
let transport: Transport | null = null;

export function setAnalyticsTransport(next: Transport | null): void {
  transport = next;
}

export function track(name: EventName, props: EventProps = {}): void {
  const event: TrackedEvent = { name, props, at: new Date().toISOString() };
  eventLog.set([event, ...eventLog.get()].slice(0, MAX_EVENTS));
  if (import.meta.env.DEV) console.debug('[analytics]', name, props);
  transport?.(event);
}

/** Coarse size bucket for dimensions, so exact sizes are not recorded. */
export function dimensionClass(width: number, height: number): string {
  const px = width * height;
  if (px <= 1_000_000) return '≤1MP';
  if (px <= 4_000_000) return '≤4MP';
  if (px <= 12_000_000) return '≤12MP';
  return '>12MP';
}

export function durationClass(ms: number): string {
  if (ms < 250) return '<250ms';
  if (ms < 1000) return '<1s';
  if (ms < 5000) return '<5s';
  return '≥5s';
}
