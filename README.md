# Material Lab

**Pureland · Visual Generation** — a procedural texture studio for designers. Build glass, grain, paper,
metallic, fabric, noise and liquid textures from editable layers. Save the recipe, make controlled variations,
and export production-ready PNG or JPEG files. The same recipe, seed and engine version always render the same
pixels.

- Product requirements: [`docs/Material_Lab_Texture_Generator_PRD.md`](docs/Material_Lab_Texture_Generator_PRD.md)
- User flows: [`docs/Material_Lab_User_Flows.md`](docs/Material_Lab_User_Flows.md)
- What is built so far, requirement by requirement: [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)
- How it works: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Repository layout

```
packages/engine       Shared, platform-neutral core: recipe schema, validation, migrations,
                      deterministic renderer, layer types, presets, variations, export rules.
apps/web              The web app (Vite + React + TypeScript): the canonical full editor.
apps/figma-plugin     Figma plugin technical prototype (inserts rendered textures).
scripts               Dev tools: render presets / contact sheets to PNG for visual QA.
docs                  PRD, user flows, architecture and implementation status.
```

## Getting started

Requires Node.js 22 or later.

```bash
npm install
npm run dev          # web app at http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the web app dev server. |
| `npm run check` | Typecheck, test and build everything (what CI runs). |
| `npm test` | Engine and web unit tests, including golden-image hashes of every preset. |
| `npm run build` | Production build of the web app (`apps/web/dist`) and the Figma plugin (`apps/figma-plugin/dist`). |
| `npm run golden:update` | Regenerate golden hashes after an **intentional** rendering change (bump `ENGINE_VERSION` too). |
| `npm run render:presets -- out/presets` | Render every preset to PNG. |
| `npx tsx scripts/contact-sheet.ts out/sheet.png --family=paper --zoom=4` | Contact sheet of presets for visual review. |

The web app is a static site: deploy `apps/web/dist` to any static host. It needs no backend.

## Principles carried through the code

- **Recipe, not just an image.** Everything that affects pixels is in a versioned JSON recipe with an explicit
  seed and per-layer seed offsets.
- **Deterministic.** Rendering uses only exactly-specified arithmetic, so output is byte-identical across
  browsers, workers and Node — and identical however the image is split into row chunks. Golden tests guard it.
- **Local-first.** Creating, saving and exporting work without an account; nothing is uploaded.
- **Honest platform behaviour.** Exports and integrations say what they produce (a rendered image), and never
  drop transparency or resolution silently.
- **Progressive complexity.** Basic controls are visible; advanced ones are collapsed.
