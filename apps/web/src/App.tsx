import { useEffect, useRef } from 'react';
import { useApp } from './AppContext';
import { AccountBadge } from './components/AccountBadge';
import { refreshAccount, restoreSession } from './lib/account';
import { track } from './lib/analytics';
import { apiBase } from './lib/api';
import { loadExportLog } from './lib/exports-log';
import { loadLibrary } from './lib/library';
import { routeHref, useRoute, type RouteName } from './lib/router';
import { applyTheme, useSettings } from './lib/settings';
import { startSync } from './lib/sync';
import { AccountScreen } from './screens/AccountScreen';
import { EditorScreen } from './screens/editor/EditorScreen';
import { ExploreScreen } from './screens/ExploreScreen';
import { ExportsScreen } from './screens/ExportsScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { InviteScreen } from './screens/InviteScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SharedScreen } from './screens/SharedScreen';
import { TeamsScreen } from './screens/TeamsScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';

const NAV: { route: RouteName; label: string; needsServer?: boolean }[] = [
  { route: 'create', label: 'Create' },
  { route: 'explore', label: 'Explore' },
  { route: 'recipes', label: 'My Recipes' },
  { route: 'teams', label: 'Teams', needsServer: true },
  { route: 'exports', label: 'Exports' },
  { route: 'settings', label: 'Settings' },
];

const TITLES: Record<RouteName, string> = {
  home: 'Material Lab',
  create: 'Create',
  explore: 'Explore presets',
  recipes: 'My Recipes',
  exports: 'Exports',
  settings: 'Settings',
  account: 'Account',
  teams: 'Teams',
  shared: 'Shared recipe',
  invite: 'Team invite',
};

export function App() {
  const route = useRoute();
  const settings = useSettings();
  const { editor, dirty } = useApp();
  const mainRef = useRef<HTMLElement>(null);
  const firstRoute = useRef(true);

  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  const entryPoint = useRef(route.name);
  useEffect(() => {
    void loadLibrary();
    void loadExportLog();
    restoreSession();
    startSync();
    void refreshAccount().catch(() => undefined);
    track('material_lab_opened', { platform: 'web', entry_point: entryPoint.current });
  }, []);

  useEffect(() => {
    const name = route.name === 'create' && editor.recipe ? `${dirty ? '• ' : ''}${editor.recipe.name}` : TITLES[route.name];
    document.title = route.name === 'home' ? 'Material Lab — Texture Generator' : `${name} · Material Lab`;
  }, [route.name, editor.recipe, dirty]);

  // Move focus to the new page for keyboard and screen reader users.
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [route.name]);

  let screen;
  switch (route.name) {
    case 'create':
      screen = <EditorScreen />;
      break;
    case 'explore':
      screen = <ExploreScreen />;
      break;
    case 'recipes':
      screen = <LibraryScreen />;
      break;
    case 'exports':
      screen = <ExportsScreen />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
    case 'account':
      screen = <AccountScreen />;
      break;
    case 'teams':
      screen = <TeamsScreen key={route.id ?? 'list'} teamId={route.id} />;
      break;
    case 'shared':
      screen = <SharedScreen token={route.id} />;
      break;
    case 'invite':
      screen = <InviteScreen token={route.id} />;
      break;
    default:
      screen = <WelcomeScreen />;
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => (e.preventDefault(), mainRef.current?.focus())}>
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand" href={routeHref('home')} aria-label="Material Lab home">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Material Lab</span>
        </a>
        <nav className="topnav" aria-label="Main">
          {NAV.filter((item) => !item.needsServer || apiBase()).map((item) => (
            <a key={item.route} href={routeHref(item.route)} className="topnav-link" aria-current={route.name === item.route ? 'page' : undefined}>
              {item.label}
              {item.route === 'create' && dirty && route.name !== 'create' && (
                <span className="dot" title="Unsaved changes" aria-label="(unsaved changes)" />
              )}
            </a>
          ))}
        </nav>
        <AccountBadge />
      </header>
      <main id="main" ref={mainRef} className={`main main-${route.name}`} tabIndex={-1}>
        {screen}
      </main>
    </div>
  );
}
