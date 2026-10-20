# Material Lab — Implementation status

Status of the first build against the PRD (`Material_Lab_Texture_Generator_PRD.md`) and user flows
(`Material_Lab_User_Flows.md`). Legend: ✅ done · 🟡 partial or prototype · ⬜ not started.

This build covers the PRD's **Phase 1 (web MVP)** and a **Figma technical prototype** (Phase 2). Accounts,
cloud sync, Canva and Framer are deliberately not started, as the PRD recommends.

## Decisions taken on open questions

| Open question (PRD §25 / flows §28) | Decision in this build |
| --- | --- |
| Local-first or account-first? | Local-first. Save, reopen and export need no account; cloud save is shown as "not available yet". |
| Export limits | 16 px to 8192 px per side and 36 MP output (after scale); memory estimated before rendering. Figma plugin: 4096 px per side (Figma's limit). |
| Layer limit | 8 layers per recipe, shown as "n/8" in the layer panel. |
| Seamless tiling in P0? | No — kept in P1. The schema already has `exportDefaults.seamless`. |
| Figma default insert behaviour | Insert a new image-filled rectangle; filling the selection is an explicit option. |
| Draft recovery | Unsaved work is mirrored to localStorage and offered back on the welcome screen, labelled as a draft until saved. |
| Analytics properties | Counts, ids of built-in presets, coarse size/duration classes, error categories. No images, recipe contents or names. Nothing is transmitted in this build. |

## Functional requirements

### Preset browser
| Req | Status | Notes |
| --- | --- | --- |
| FR-001 (P0) presets by family | ✅ | 21 presets, 2–3 per family; family filter chips. |
| FR-002 (P0) preview, name, family, description | ✅ | Plus use cases and a "Transparent" badge. |
| FR-003 (P0) search by name/family/tag/use case | ✅ | Multi-word search. |
| FR-004 (P1) filter by style, palette, seamless | 🟡 | Style tags are searchable; no dedicated filter controls. |
| FR-005 (P0) preset opens an editable recipe | ✅ | `instantiatePreset` copies; the canonical preset is never modified (tested). |
| FR-006 (P0) beta / unsupported labels | ✅ | Beta badge and limitation text supported; no preset currently needs it. |

### Layers
| Req | Status | Notes |
| --- | --- | --- |
| FR-010/011/012 (P0) add, remove, duplicate, rename, reorder, toggle, opacity | ✅ | Drag-and-drop and Alt+↑/↓ reordering; Delete key with Undo toast. |
| FR-013 (P0) only relevant controls | ✅ | Generated from layer definitions, including conditional parameters. |
| FR-014 (P1) blend modes | ✅ | Normal, multiply, screen, overlay, soft light; preview and export share one renderer. |
| FR-015 (P0) single-layer recipes, communicated limit | ✅ | |
| FR-016 (P0) warn before losing unsaved work | ✅ | Save / Discard / Cancel dialog, browser prompt on tab close, draft recovery. |

### Controls
| Req | Status | Notes |
| --- | --- | --- |
| FR-020–023 (P0) live update, ranges, numeric entry, reset | ✅ | Invalid entries are explained and never applied. |
| FR-024/025 (P0) explicit seed; "New variation" changes only the seed | ✅ | Tested. |
| FR-026 (P1) global palette mapping | ⬜ | |
| FR-027 (P1) HEX/RGB input | 🟡 | HEX field + native color picker; no RGB fields. |
| FR-028 (P1) advanced collapsed | ✅ | |

### Preview and rendering
| Req | Status | Notes |
| --- | --- | --- |
| FR-030–035 (P0) | ✅ | Worker pool, draft → full preview, preview-vs-export label, stale frames never replace newer ones, progress chip, last good frame kept on error with Retry. |
| FR-036 (P1) checkerboard / tiling preview | 🟡 | Checkerboard, light and dark preview backgrounds; no tiling preview. |
| FR-037 (P1) before/after comparison | 🟡 | Side-by-side compare for variations. |

### Recipes
| Req | Status | Notes |
| --- | --- | --- |
| FR-040 (P0) save, rename, duplicate, delete, favorite, reopen | ✅ | IndexedDB; name conflicts offer Replace / Save as copy / Change name. |
| FR-041 (P0) stored fields | ✅ | Layer stack, parameters, seed, schema version, engine version, export defaults. |
| FR-042 (P0) export without an account | ✅ | |
| FR-043 (P0) sign-in sync "if enabled for the release" | ⬜ | Not enabled; the UI says so truthfully. |
| FR-044 (P1) JSON import/export with validation | ✅ | Size limits, schema validation, compatibility warnings; imports become new recipes. |
| FR-045/046/047 history, share links, team folders | ⬜ | |

### Export
| Req | Status | Notes |
| --- | --- | --- |
| FR-050–056 (P0) | ✅ | PNG/JPEG, alpha rules, size presets + custom, 1–4× scale, validation with memory estimate and recommended size, file naming, metadata, progress with cancel, retry / reduce size / switch format. |
| FR-057/058/059 (P1) seamless tiles, batch, SVG | ⬜ | |
| FR-060 (P2) animated | ⬜ | |

### Platform integrations
| Req | Status | Notes |
| --- | --- | --- |
| FR-070 (P0) standalone web app | ✅ | |
| FR-071/072 (P1) Figma insert, reports image-backed result | 🟡 | Prototype in `apps/figma-plugin`. Verified with a mocked API and browser harness; **not yet run in Figma**. |
| FR-073/074 Canva, Framer | ⬜ | Need technical spikes first (PRD §7). |
| FR-075 (P0) graceful handling of unavailable features | ✅ | IndexedDB → in-memory fallback; OffscreenCanvas → canvas fallback; plugin offers "fill" only for fillable selections. |
| FR-076 (P0) no false parity claims | ✅ | Glass and metal labelled stylised; plugin and settings say integrations produce images. |

### Optional AI (FR-080–084, P2)
⬜ Not started. The engine works without any AI call.

## MVP acceptance criteria (PRD §24)

| Criterion | Status |
| --- | --- |
| Preset or blank start | ✅ |
| Add, remove, rename, reorder, duplicate, toggle layers | ✅ |
| Documented controls and ranges for every family | ✅ (layer definitions are the documentation; generated UI) |
| Preview updates without reload | ✅ |
| New variation changes only intended properties | ✅ (unit-tested) |
| Undo/redo | ✅ (unit-tested) |
| Save, reopen, duplicate, rename, delete locally | ✅ |
| Same inputs reproduce output | ✅ byte-identical; golden tests in CI |
| Invalid imported data rejected safely | ✅ (unit-tested) |
| Schema migration test in the pipeline | ✅ (framework test; no real migrations yet) |
| PNG and JPEG at supported dimensions; transparency as indicated | ✅ (browser-tested) |
| Actionable failure messages; very large outputs validated | ✅ |
| Preview latency meets threshold on reference hardware | 🟡 Reference hardware not defined yet. 0.2–0.6 s settle after edits on a 4-core container; needs measuring on typical desktops. |
| Long export shows progress | ✅ |
| Keyboard navigation; accessible labels; not colour-only | ✅ Baseline done; no formal audit yet. |
| Web app works without platform login | ✅ |
| Figma insertion demonstrated in a technical prototype | 🟡 Prototype built; needs a run inside Figma. |
| Canva/Framer roadmap reflects only verified behaviour | ✅ Shown as "Planned". |
| Analytics events validated; no images or full recipes sent | ✅ Events in place and viewable under Settings → Privacy; nothing is transmitted. |

## Verification done for this build

- `npm run check`: typecheck, 99 unit tests (engine and editor state), production builds.
- Browser runs (Chromium) of the main flows, with no console errors:
  - preset → edit → undo → variations → compare → export → download → save;
  - unsaved-changes guard; blank recipe and layer operations; keyboard reorder and delete;
  - invalid JSON import; JPEG transparency guard; oversize export recommendation; transparent PNG export;
  - draft recovery after reload; dark theme; 390 px phone layout.
- Visual review of every preset (`scripts/contact-sheet.ts`).

## Suggested next steps

1. Run the Figma prototype inside Figma; decide on fill-vs-new defaults with designers (flows §28 Q4).
2. Define the reference hardware and browser matrix; measure preview p95. Consider a WebGL path validated
   against golden images if CPU rendering misses the target.
3. User testing on preset quality per family (PRD Phase 0 interviews), then tune or mark presets beta.
4. P1 items: seamless tiling and tile export, recipe version history, palette mapping, batch export of variations.
5. Account and sync service (PRD §15 API) once cross-platform demand is validated.
