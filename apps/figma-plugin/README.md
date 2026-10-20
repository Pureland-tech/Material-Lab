# Material Lab — Figma plugin (technical prototype)

Prototype of the Figma insertion flow (PRD flow D, user-flow H). It renders textures with the shared
`@material-lab/engine` inside the plugin UI and inserts the result as an **image-filled shape** using the
documented [`figma.createImage`](https://developers.figma.com/docs/plugins/api/properties/figma-createimage/) API.

> Status: built and exercised against a mock of the plugin API and in a browser harness. It has **not yet been
> run inside Figma**. Verify it there before treating the integration as done (PRD §24, "Figma insertion flow is
> demonstrated in a technical prototype").

## What it does

- Start from any preset, or **Open recipe…** to load a recipe JSON exported from the web app.
  (Recipes saved in the web app live in that site's browser storage, which a plugin cannot read; cloud sync is
  not built yet.)
- Adjust the seed (**New variation** changes only the seed) and the top layer's basic controls.
- Choose an output size. Figma accepts images up to **4096 px per side**; larger sizes are blocked with a
  suggested size instead of being silently reduced.
- **Insert as**:
  - _New rectangle at the center of the view_ (default; never touches the selection), or
  - _Image fill on selected layers_ — only offered when the selection can take a fill, and labelled as
    replacing their fills.
- Each inserted node stores a **recipe reference** in plugin data (`materialLabRecipe`). Selecting it later shows
  “Load recipe” so the texture can be adjusted and re-rendered. The node itself is a rendered image: shader
  parameters are not editable inside Figma.

Rendering happens locally in the plugin iframe; the manifest declares no network access.

## Build and load

```bash
npm install                # at the repository root
npm run build --workspace @material-lab/figma-plugin
```

In the Figma desktop app: **Plugins → Development → Import plugin from manifest…** and choose
`apps/figma-plugin/manifest.json`. Use `npm run watch --workspace @material-lab/figma-plugin` while developing.

Before publishing, replace the placeholder `id` in `manifest.json` with the id Figma assigns.

## Files

| File | Role |
| --- | --- |
| `src/code.ts` | Figma main thread: creates the image, inserts or fills, stores the recipe reference, reports selection. |
| `src/ui.ts`, `src/ui.html` | Plugin UI: preset/recipe loading, controls, chunked rendering, PNG encoding. |
| `src/messages.ts` | Message types shared by both sides, the 4096 px limit and the plugin data key. |
| `build.mjs` | esbuild bundling; inlines the UI script into `dist/ui.html` as Figma requires. |

## Known gaps to validate in Figma

- Rendering runs on the UI thread in 128-row chunks, so large inserts keep the UI responsive but are slower than
  the web app's worker pool.
- Behaviour with components, instances and locked layers in the selection.
- Plugin data size with very large recipes (recipes are small, typically a few KB).
