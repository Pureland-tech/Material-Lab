import { getPreset, instantiatePreset, type Recipe } from '@material-lab/engine';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AiError, type Suggester } from '../src/ai';
import { createApp, type App } from '../src/app';
import { loadConfig } from '../src/config';

interface Client {
  app: App;
  base: string;
  call: (method: string, path: string, options?: { token?: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; body: any; headers: Headers }>;
  signup: (email: string, name?: string) => Promise<{ token: string; id: string }>;
}

const apps: App[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function start(suggester: Suggester | null = null): Promise<Client> {
  const config = { ...loadConfig({}), databasePath: ':memory:', publicWebUrl: 'https://lab.example', allowedOrigins: ['https://lab.example'] };
  const app = createApp(config, { suggester });
  apps.push(app);
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const call: Client['call'] = async (method, path, options = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['Content-Type'] ??= 'application/json';
    const res = await fetch(base + path, { method, headers, body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body) });
    const type = res.headers.get('content-type') ?? '';
    const body = type.includes('json') ? await res.json() : type.startsWith('image/') ? new Uint8Array(await res.arrayBuffer()) : await res.text();
    return { status: res.status, body, headers: res.headers };
  };
  const signup: Client['signup'] = async (email, name) => {
    const r = await call('POST', '/v1/auth/signup', { body: { email, password: 'correct horse battery', name: name ?? email.split('@')[0] } });
    expect(r.status).toBe(201);
    return { token: r.body.token, id: r.body.user.id };
  };
  return { app, base, call, signup };
}

function recipe(presetId = 'paper-warm-recycled'): Recipe {
  return instantiatePreset(getPreset(presetId) ?? getPreset('liquid-calm-flow')!);
}

describe('public endpoints', () => {
  it('serves health and the preset catalogue with caching', async () => {
    const c = await start();
    const health = await c.call('GET', '/healthz');
    expect(health.body).toMatchObject({ ok: true, ai: false });
    const list = await c.call('GET', '/v1/presets');
    expect(list.status).toBe(200);
    expect(list.body.presets.length).toBeGreaterThan(10);
    expect(list.body.presets[0]).not.toHaveProperty('recipe');
    const again = await c.call('GET', '/v1/presets', { headers: { 'If-None-Match': list.headers.get('etag')! } });
    expect(again.status).toBe(304);
    const one = await c.call('GET', `/v1/presets/${list.body.presets[0].id}`);
    expect(one.body.recipe.layers.length).toBeGreaterThan(0);
    expect((await c.call('GET', '/v1/presets/nope')).body.error.code).toBe('preset_not_found');
    expect((await c.call('GET', '/v1/nothing')).status).toBe(404);
    expect((await c.call('PUT', '/v1/presets')).status).toBe(405);
  });

  it('applies CORS per endpoint', async () => {
    const c = await start();
    const pre = await c.call('OPTIONS', '/v1/recipes', { headers: { Origin: 'https://lab.example', 'Access-Control-Request-Method': 'POST' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://lab.example');
    const evil = await c.call('OPTIONS', '/v1/recipes', { headers: { Origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const pub = await c.call('GET', '/v1/presets', { headers: { Origin: 'https://evil.example' } });
    expect(pub.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('accounts', () => {
  it('signs up, signs in, and rejects bad credentials', async () => {
    const c = await start();
    expect((await c.call('POST', '/v1/auth/signup', { body: { email: 'a@x.io', password: 'short' } })).body.error.code).toBe('weak_password');
    expect((await c.call('POST', '/v1/auth/signup', { body: { email: 'nope', password: 'long enough pw' } })).body.error.code).toBe('invalid_email');
    const { token } = await c.signup('Ana@Example.com', 'Ana');
    expect((await c.call('POST', '/v1/auth/signup', { body: { email: 'ana@example.com', password: 'another password' } })).body.error.code).toBe('email_taken');
    expect((await c.call('POST', '/v1/auth/login', { body: { email: 'ana@example.com', password: 'wrong password!' } })).status).toBe(401);
    expect((await c.call('POST', '/v1/auth/login', { body: { email: 'ghost@example.com', password: 'wrong password!' } })).body.error.code).toBe('invalid_credentials');
    const login = await c.call('POST', '/v1/auth/login', { body: { email: 'ANA@example.com', password: 'correct horse battery' } });
    expect(login.status).toBe(200);
    const me = await c.call('GET', '/v1/me', { token: login.body.token });
    expect(me.body.user).toMatchObject({ email: 'ana@example.com', name: 'Ana', plan: 'free' });
    expect(me.body.entitlements.limits.cloudRecipes).toBe(100);
    expect((await c.call('GET', '/v1/me')).body.error.code).toBe('unauthenticated');
    await c.call('POST', '/v1/auth/logout', { token });
    expect((await c.call('GET', '/v1/me', { token })).status).toBe(401);
    expect((await c.call('GET', '/v1/me', { token: login.body.token })).status).toBe(200);
  });

  it('rate limits sign-in attempts', async () => {
    const c = await start();
    let last;
    for (let i = 0; i < 11; i++) last = await c.call('POST', '/v1/auth/login', { body: { email: 'x@y.io', password: 'whatever pw' } });
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('validates bodies', async () => {
    const c = await start();
    const { token } = await c.signup('b@x.io');
    expect((await c.call('POST', '/v1/recipes', { token, body: '{bad', headers: { 'Content-Type': 'application/json' } })).body.error.code).toBe('invalid_json');
    expect((await c.call('POST', '/v1/recipes', { token, body: 'x', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    const big = await c.call('POST', '/v1/recipes', { token, body: { recipe: { name: 'x'.repeat(400_000) } } });
    expect(big.status).toBe(413);
  });

  it('exports and deletes an account', async () => {
    const c = await start();
    const { token } = await c.signup('del@x.io');
    await c.call('POST', '/v1/recipes', { token, body: { recipe: recipe() } });
    const exp = await c.call('GET', '/v1/me/export', { token });
    expect(exp.body.recipes).toHaveLength(1);
    expect((await c.call('DELETE', '/v1/me', { token, body: { password: 'nope nope nope' } })).status).toBe(403);
    expect((await c.call('DELETE', '/v1/me', { token, body: { password: 'correct horse battery' } })).status).toBe(204);
    expect((await c.call('GET', '/v1/me', { token })).status).toBe(401);
    expect(c.app.db.prepare('SELECT COUNT(*) AS n FROM recipes').get()).toEqual({ n: 0 });
  });
});

describe('recipe sync', () => {
  it('creates, reads, updates with optimistic concurrency, and deletes with tombstones', async () => {
    const c = await start();
    const { token } = await c.signup('s@x.io');
    const r = recipe();
    const created = await c.call('POST', '/v1/recipes', { token, body: { recipe: r } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ recipeId: r.recipeId, version: 1, deleted: false });
    expect((await c.call('POST', '/v1/recipes', { token, body: { recipe: r } })).body.error.code).toBe('recipe_exists');

    const edited = { ...r, name: 'Edited on laptop' };
    expect((await c.call('PATCH', `/v1/recipes/${r.recipeId}`, { token, body: { recipe: edited } })).status).toBe(428);
    const v2 = await c.call('PATCH', `/v1/recipes/${r.recipeId}`, { token, body: { recipe: edited, baseVersion: 1 } });
    expect(v2.body.version).toBe(2);
    expect(v2.headers.get('etag')).toBe('"2"');
    // A second device still on version 1 gets a conflict with the current copy, never an overwrite.
    const stale = await c.call('PATCH', `/v1/recipes/${r.recipeId}`, { token, body: { recipe: { ...r, name: 'Edited on phone' }, baseVersion: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');
    expect(stale.body.error.current.recipe.name).toBe('Edited on laptop');
    expect((await c.call('PATCH', `/v1/recipes/${r.recipeId}`, { token, body: { recipe: { ...edited, recipeId: 'other' }, baseVersion: 2 } })).body.error.code).toBe('id_mismatch');

    const invalid = await c.call('POST', '/v1/recipes', { token, body: { recipe: { schemaVersion: 999 } } });
    expect(invalid.status).toBe(422);

    const before = new Date(Date.now() - 1000).toISOString();
    expect((await c.call('DELETE', `/v1/recipes/${r.recipeId}?baseVersion=1`, { token })).status).toBe(409);
    expect((await c.call('DELETE', `/v1/recipes/${r.recipeId}`, { token })).status).toBe(204);
    expect((await c.call('GET', `/v1/recipes/${r.recipeId}`, { token })).status).toBe(404);
    const active = await c.call('GET', '/v1/recipes', { token });
    expect(active.body.recipes).toHaveLength(0);
    const changes = await c.call('GET', `/v1/recipes?since=${encodeURIComponent(before)}`, { token });
    expect(changes.body.recipes).toEqual([expect.objectContaining({ recipeId: r.recipeId, deleted: true, version: 3 })]);
    const revived = await c.call('POST', '/v1/recipes', { token, body: { recipe: r } });
    expect(revived.body.version).toBe(4);
  });

  it('keeps users apart and pages listings', async () => {
    const c = await start();
    const a = await c.signup('a@x.io');
    const b = await c.signup('b@x.io');
    const r = recipe();
    await c.call('POST', '/v1/recipes', { token: a.token, body: { recipe: r } });
    expect((await c.call('GET', `/v1/recipes/${r.recipeId}`, { token: b.token })).status).toBe(404);
    expect((await c.call('PATCH', `/v1/recipes/${r.recipeId}`, { token: b.token, body: { recipe: r, baseVersion: 1 } })).status).toBe(404);
    expect((await c.call('DELETE', `/v1/recipes/${r.recipeId}`, { token: b.token })).status).toBe(404);
    // The same id in another account is a different recipe.
    expect((await c.call('POST', '/v1/recipes', { token: b.token, body: { recipe: r } })).status).toBe(201);

    for (let i = 0; i < 4; i++) await c.call('POST', '/v1/recipes', { token: a.token, body: { recipe: recipe() } });
    const page1 = await c.call('GET', '/v1/recipes?limit=3&fields=summary', { token: a.token });
    expect(page1.body.recipes).toHaveLength(3);
    expect(page1.body.recipes[0]).not.toHaveProperty('recipe');
    const page2 = await c.call('GET', `/v1/recipes?limit=3&cursor=${page1.body.nextCursor}`, { token: a.token });
    expect(page2.body.recipes).toHaveLength(2);
    expect(page2.body.nextCursor).toBeNull();
  });
});

describe('share links', () => {
  it('shares read-only, previews, duplicates on request, and revokes', async () => {
    const c = await start();
    const owner = await c.signup('o@x.io', 'Olu');
    const other = await c.signup('p@x.io');
    const r = recipe();
    await c.call('POST', '/v1/recipes', { token: owner.token, body: { recipe: r } });
    expect((await c.call('POST', `/v1/recipes/${r.recipeId}/share`, { token: other.token, body: {} })).status).toBe(404);

    const view = await c.call('POST', `/v1/recipes/${r.recipeId}/share`, { token: owner.token, body: { access: 'view' } });
    expect(view.status).toBe(201);
    expect(view.body.share.url).toMatch(/^https:\/\/lab\.example\/#\/shared\/mlx_/);
    const token = view.body.share.url.split('/shared/')[1];
    const shared = await c.call('GET', `/v1/shared/${token}`);
    expect(shared.body.recipe.name).toBe(r.name);
    expect(shared.body.sharedBy).toEqual({ kind: 'user', name: 'Olu' });
    expect(shared.body.fullRecipe).toBeNull();
    const png = await c.call('GET', `/v1/shared/${token}/preview.png?width=200`);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect([...png.body.subarray(1, 4)].map((b: number) => String.fromCharCode(b)).join('')).toBe('PNG');

    const dup = await c.call('POST', `/v1/recipes/${r.recipeId}/share`, { token: owner.token, body: { access: 'duplicate', expiresInDays: 7 } });
    const dupToken = dup.body.share.url.split('/shared/')[1];
    expect((await c.call('GET', `/v1/shared/${dupToken}`)).body.fullRecipe.recipeId).toBe(r.recipeId);

    const list = await c.call('GET', `/v1/recipes/${r.recipeId}/shares`, { token: owner.token });
    expect(list.body.shares).toHaveLength(2);
    expect((await c.call('DELETE', `/v1/shares/${view.body.share.id}`, { token: other.token })).status).toBe(404);
    expect((await c.call('DELETE', `/v1/shares/${view.body.share.id}`, { token: owner.token })).status).toBe(204);
    expect((await c.call('GET', `/v1/shared/${token}`)).body.error.code).toBe('share_revoked');
    expect((await c.call('GET', '/v1/shared/mlx_doesnotexist')).body.error.code).toBe('share_not_found');

    c.app.db.prepare("UPDATE shares SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(dup.body.share.id);
    expect((await c.call('GET', `/v1/shared/${dupToken}`)).body.error.code).toBe('share_expired');

    const again = await c.call('POST', `/v1/recipes/${r.recipeId}/share`, { token: owner.token, body: {} });
    await c.call('DELETE', `/v1/recipes/${r.recipeId}`, { token: owner.token });
    const gone = await c.call('GET', `/v1/shared/${again.body.share.url.split('/shared/')[1]}`);
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('recipe_deleted');
  });
});

describe('teams', () => {
  it('runs a team library with roles, folders, approvals and activity', async () => {
    const c = await start();
    const owner = await c.signup('own@x.io', 'Owner');
    const editor = await c.signup('ed@x.io', 'Editor');
    const viewer = await c.signup('vi@x.io', 'Viewer');
    const outsider = await c.signup('out@x.io');

    const team = (await c.call('POST', '/v1/teams', { token: owner.token, body: { name: 'Brand studio' } })).body.team;
    expect(team.role).toBe('owner');
    expect((await c.call('POST', '/v1/teams', { token: owner.token, body: { name: 'Second' } })).body.error.code).toBe('quota_exceeded');
    expect((await c.call('GET', `/v1/teams/${team.id}`, { token: outsider.token })).status).toBe(404);

    const invE = (await c.call('POST', `/v1/teams/${team.id}/invites`, { token: owner.token, body: { role: 'editor' } })).body.invite;
    const invV = (await c.call('POST', `/v1/teams/${team.id}/invites`, { token: owner.token, body: { role: 'viewer' } })).body.invite;
    const tokE = invE.url.split('/invite/')[1];
    expect((await c.call('GET', `/v1/invites/${tokE}`, { token: editor.token })).body.team.name).toBe('Brand studio');
    expect((await c.call('POST', `/v1/invites/${tokE}/accept`, { token: editor.token })).body.team.role).toBe('editor');
    expect((await c.call('POST', `/v1/invites/${tokE}/accept`, { token: viewer.token })).body.error.code).toBe('invite_used');
    await c.call('POST', `/v1/invites/${invV.url.split('/invite/')[1]}/accept`, { token: viewer.token });

    const folder = (await c.call('POST', `/v1/teams/${team.id}/folders`, { token: editor.token, body: { name: 'Campaign' } })).body.folder;
    expect((await c.call('POST', `/v1/teams/${team.id}/folders`, { token: viewer.token, body: { name: 'Nope' } })).status).toBe(403);

    const r = recipe();
    const added = await c.call('POST', `/v1/teams/${team.id}/recipes`, { token: editor.token, body: { recipe: r, folderId: folder.id } });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ folderId: folder.id, createdBy: { name: 'Editor' }, approval: null });
    expect((await c.call('POST', `/v1/teams/${team.id}/recipes`, { token: viewer.token, body: { recipe: recipe() } })).status).toBe(403);
    expect((await c.call('GET', `/v1/teams/${team.id}/recipes?folderId=${folder.id}`, { token: viewer.token })).body.recipes).toHaveLength(1);

    // Approval is for a specific version, by an owner.
    expect((await c.call('POST', `/v1/teams/${team.id}/recipes/${r.recipeId}/approval`, { token: editor.token, body: { version: 1 } })).status).toBe(403);
    const approved = await c.call('POST', `/v1/teams/${team.id}/recipes/${r.recipeId}/approval`, { token: owner.token, body: { version: 1 } });
    expect(approved.body.approval).toMatchObject({ approvedVersion: 1, current: true, approvedBy: { name: 'Owner' } });
    expect((await c.call('GET', `/v1/teams/${team.id}/recipes?approved=true`, { token: viewer.token })).body.recipes).toHaveLength(1);
    expect((await c.call('DELETE', `/v1/teams/${team.id}/recipes/${r.recipeId}`, { token: editor.token })).body.error.code).toBe('forbidden');

    // Moving folders keeps approval; changing content clears it.
    const moved = await c.call('PATCH', `/v1/teams/${team.id}/recipes/${r.recipeId}`, { token: editor.token, body: { folderId: null, baseVersion: 1 } });
    expect(moved.body).toMatchObject({ folderId: null, approvalCleared: false });
    const edited = await c.call('PATCH', `/v1/teams/${team.id}/recipes/${r.recipeId}`, { token: editor.token, body: { recipe: { ...r, name: 'Changed' }, baseVersion: 2 } });
    expect(edited.body).toMatchObject({ approvalCleared: true, approval: null, version: 3 });
    expect((await c.call('POST', `/v1/teams/${team.id}/recipes/${r.recipeId}/approval`, { token: owner.token, body: { version: 2 } })).body.error.code).toBe('version_conflict');

    const share = await c.call('POST', `/v1/teams/${team.id}/recipes/${r.recipeId}/share`, { token: editor.token, body: { access: 'duplicate' } });
    const shared = await c.call('GET', `/v1/shared/${share.body.share.url.split('/shared/')[1]}`);
    expect(shared.body.sharedBy).toEqual({ kind: 'team', name: 'Brand studio' });

    // Roles and the last owner.
    expect((await c.call('DELETE', `/v1/teams/${team.id}/members/${owner.id}`, { token: owner.token })).body.error.code).toBe('last_owner');
    expect((await c.call('PATCH', `/v1/teams/${team.id}/members/${owner.id}`, { token: owner.token, body: { role: 'editor' } })).body.error.code).toBe('last_owner');
    expect((await c.call('PATCH', `/v1/teams/${team.id}/members/${viewer.id}`, { token: editor.token, body: { role: 'owner' } })).status).toBe(403);
    expect((await c.call('DELETE', `/v1/teams/${team.id}/members/${viewer.id}`, { token: viewer.token })).status).toBe(204);
    // An owner of a team with other members must hand it over before deleting their account.
    expect((await c.call('DELETE', '/v1/me', { token: owner.token, body: { password: 'correct horse battery' } })).body.error.code).toBe('transfer_ownership_first');

    const activity = await c.call('GET', `/v1/teams/${team.id}/activity`, { token: editor.token });
    const actions = activity.body.activity.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['team.created', 'member.joined', 'recipe.added', 'recipe.approved', 'recipe.edited_approved', 'member.left']));
    const detail = await c.call('GET', `/v1/teams/${team.id}`, { token: owner.token });
    expect(detail.body.members.map((m: { role: string }) => m.role)).toEqual(['owner', 'editor']);

    expect((await c.call('DELETE', `/v1/teams/${team.id}`, { token: editor.token })).status).toBe(403);
    expect((await c.call('DELETE', `/v1/teams/${team.id}`, { token: owner.token })).status).toBe(204);
    expect((await c.call('GET', '/v1/teams', { token: editor.token })).body.teams).toEqual([]);
  });
});

describe('AI recipe suggestions', () => {
  const spec = {
    name: 'Kraft fibers',
    explanation: 'Warm kraft paper with dark fibers.',
    transparentBackground: false,
    seamless: false,
    layers: [{ type: 'paper-fiber', name: 'Kraft', opacity: 1, blendMode: 'normal', parameters: { tone: '#C8A77A' } }],
  };

  it('requires consent and returns an editable recipe from the model', async () => {
    const prompts: string[] = [];
    const c = await start({ suggest: async (p) => (prompts.push(p), spec) });
    const { token } = await c.signup('ai@x.io');
    expect((await c.call('POST', '/v1/ai/recipe-suggestion', { token, body: { prompt: 'kraft paper' } })).body.error.code).toBe('consent_required');
    expect((await c.call('POST', '/v1/ai/recipe-suggestion', { body: { prompt: 'kraft paper', consent: true } })).status).toBe(401);
    const r = await c.call('POST', '/v1/ai/recipe-suggestion', { token, body: { prompt: 'kraft paper with dark fibers', consent: true } });
    expect(r.status).toBe(200);
    expect(r.body.notice).toBeNull();
    expect(r.body.suggestion).toMatchObject({ source: 'ai', summary: 'Warm kraft paper with dark fibers.' });
    expect(r.body.suggestion.recipe.layers[0].parameters.tone).toBe('#C8A77A');
    expect(r.body.suggestion.choices).toEqual(expect.arrayContaining([expect.objectContaining({ param: 'tone', value: '#C8A77A' })]));
    expect(prompts).toEqual(['kraft paper with dark fibers']);
    expect((await c.call('GET', '/v1/me', { token })).body.entitlements.usage.aiSuggestionsToday).toBe(1);
  });

  it('falls back to the built-in matcher when AI is off, failing, refusing or over quota', async () => {
    const off = await start(null);
    const t1 = (await off.signup('a@x.io')).token;
    const r1 = await off.call('POST', '/v1/ai/recipe-suggestion', { token: t1, body: { prompt: 'brushed gold metal', consent: true } });
    expect(r1.body.suggestion.source).toBe('local');
    expect(r1.body.suggestion.recipe.family).toBe('metallic');
    expect(r1.body.notice).toMatch(/not enabled/);

    const failing = await start({ suggest: async () => { throw new AiError('unavailable', 'down'); } });
    const t2 = (await failing.signup('b@x.io')).token;
    expect((await failing.call('POST', '/v1/ai/recipe-suggestion', { token: t2, body: { prompt: 'linen', consent: true } })).body.notice).toMatch(/unavailable/);

    const refusing = await start({ suggest: async () => { throw new AiError('refused', 'no'); } });
    const t3 = (await refusing.signup('c@x.io')).token;
    expect((await refusing.call('POST', '/v1/ai/recipe-suggestion', { token: t3, body: { prompt: 'linen', consent: true } })).body.notice).toMatch(/declined/);

    const garbage = await start({ suggest: async () => ({ layers: [{ type: 'nope' }] }) });
    const t4 = (await garbage.signup('d@x.io')).token;
    const r4 = await garbage.call('POST', '/v1/ai/recipe-suggestion', { token: t4, body: { prompt: 'linen', consent: true } });
    expect(r4.body.suggestion.source).toBe('local');

    const ok = await start({ suggest: async () => spec });
    const u = await ok.signup('e@x.io');
    ok.app.db.prepare('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 10)').run(u.id, new Date().toISOString().slice(0, 10));
    expect((await ok.call('POST', '/v1/ai/recipe-suggestion', { token: u.token, body: { prompt: 'linen', consent: true } })).body.notice).toMatch(/today/);
  });
});
