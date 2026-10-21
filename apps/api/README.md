# Material Lab API

Optional account service for the web app and plugins. Material Lab works fully
without it (local-first); the API adds what needs an account or shared state:

| Area | Endpoints |
|---|---|
| Health, presets (public) | `GET /healthz`, `GET /v1/presets`, `GET /v1/presets/:id` |
| Accounts | `POST /v1/auth/signup`, `POST /v1/auth/login`, `POST /v1/auth/logout`, `DELETE /v1/auth/sessions`, `GET/PATCH/DELETE /v1/me`, `GET /v1/me/export`, `GET /v1/entitlements` |
| Recipe sync | `GET/POST /v1/recipes`, `GET/PATCH/DELETE /v1/recipes/:recipeId` |
| Share links | `POST /v1/recipes/:id/share`, `GET /v1/recipes/:id/shares`, `DELETE /v1/shares/:shareId`, `GET /v1/shared/:token`, `GET /v1/shared/:token/preview.png` (public) |
| Teams | `POST/GET /v1/teams`, `GET/PATCH/DELETE /v1/teams/:teamId`, invites, members, folders, team recipes, approvals, share, activity |
| AI assistant | `POST /v1/ai/recipe-suggestion` |

## Behaviour

- **Errors** are `{ "error": { "code", "message", … } }` with stable codes
  (`version_conflict`, `share_revoked`, `quota_exceeded`, …) and messages safe to show users.
- **Sync** uses optimistic concurrency: updates send `baseVersion` (or `If-Match`); a stale
  version gets `409 version_conflict` with the current copy, never an overwrite. Deletes leave
  tombstones so `GET /v1/recipes?since=…` reports them to other devices.
- **Validation**: every recipe passes the engine's `validateRecipe` (same rules as file import).
  Bodies are capped at 300 KB; recipes at 256 KB.
- **Access**: other users' recipes and teams answer 404, not 403. Team roles are
  `viewer` < `editor` < `owner`; editing an approved recipe clears its approval, and only
  owners approve or delete approved recipes. A team always keeps one owner.
- **Share links** are unguessable tokens. `view` links show metadata and a server-rendered
  PNG preview only; `duplicate` links also return the recipe so it can be copied. Revoked,
  expired and deleted links fail with `410` and distinct codes.
- **Security**: scrypt password hashes; session tokens stored as SHA-256 hashes; token-bucket
  rate limits per IP or user (`Retry-After` on 429); CORS restricted to `ALLOWED_ORIGINS`
  (public endpoints allow any origin, without credentials); logs record route patterns, never
  raw paths, tokens or bodies.
- **AI** (optional, FR-080–084): needs `consent: true` in each request because the description
  is sent to Anthropic's Claude API. Only the description is sent, never recipes or images.
  Claude's reply is constrained to a JSON schema generated from the engine's layer
  definitions, then validated and clamped. When AI is off, over the daily quota, refused or
  failing, the engine's deterministic keyword matcher answers instead, with a notice.
- **Plans**: `free`, `pro`, `studio` limits live in `src/plans.ts`. Billing is not
  implemented; a user's plan is a database field.

## Running

```sh
npm run dev --workspace @material-lab/api        # http://127.0.0.1:8787, watches src/
npm run build --workspace @material-lab/api && npm start --workspace @material-lab/api
npm test --workspace @material-lab/api
```

| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | `8787`, `127.0.0.1` | Listen address |
| `DATABASE_PATH` | `data/material-lab.db` | SQLite file (`node:sqlite`, Node ≥ 22.5) |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Web origins for account endpoints |
| `PUBLIC_WEB_URL` | `http://localhost:5173` | Base for share and invite links |
| `TRUST_PROXY` | off | `1` to use `X-Forwarded-For` behind a trusted proxy |
| `SESSION_DAYS` | `30` | Session lifetime |
| `MATERIAL_LAB_AI` | `auto` | `auto` (on when `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` is set), `on`, or `off` |
| `MATERIAL_LAB_AI_MODEL` | `claude-opus-5-5` | Model for suggestions |
| `MATERIAL_LAB_AI_EFFORT` | `low` | `low`, `medium` or `high` |
| `MATERIAL_LAB_AI_TIMEOUT_MS` | `45000` | Per-request timeout |

## Limits of this prototype

- One process: rate limits and the preview cache are in memory, and share previews render on
  the request thread (bounded to 800 px wide and cached). Use worker threads and a shared
  store before scaling out.
- No email delivery: invites are links the owner copies. No password reset flow yet.
- The Claude integration was verified against a mock of the Messages API (request shape,
  refusal and rate-limit handling), not against the live service.
