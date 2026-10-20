/**
 * Plugin UI (runs in Figma's iframe). Renders textures with the shared engine
 * and sends PNG bytes to the main thread for insertion.
 */
import {
  ENGINE_VERSION,
  FAMILY_IDS,
  FAMILY_LABELS,
  getLayerDefinition,
  instantiatePreset,
  isParamVisible,
  normalizeSeed,
  parseRecipeJson,
  PRESETS,
  randomSeed,
  renderRecipe,
  type Layer,
  type ParamDef,
  type ParamValue,
  type Recipe,
} from '@material-lab/engine';
import { FIGMA_MAX_IMAGE_SIDE, type InsertMode, type PluginToUi, type SelectionInfo, type UiToPlugin } from './messages';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const presetSelect = $<HTMLSelectElement>('preset');
const preview = $<HTMLCanvasElement>('preview');
const seedInput = $<HTMLInputElement>('seed');
const controls = $<HTMLDivElement>('controls');
const widthInput = $<HTMLInputElement>('width');
const heightInput = $<HTMLInputElement>('height');
const scaleSelect = $<HTMLSelectElement>('scale');
const sizeError = $<HTMLParagraphElement>('size-error');
const insertButton = $<HTMLButtonElement>('insert');
const status = $<HTMLParagraphElement>('status');
const fillRadio = $<HTMLInputElement>('mode-fill');
const fillLabel = $<HTMLSpanElement>('fill-label');
const referenceBox = $<HTMLDivElement>('reference');
const fileInput = $<HTMLInputElement>('file');

let recipe: Recipe = instantiatePreset(PRESETS[0]!);
let selection: SelectionInfo = { count: 0, fillable: 0, reference: null };
let busy = false;

function send(message: UiToPlugin): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.classList.toggle('error', error);
}

// ---- Preview -------------------------------------------------------------

let previewQueued = false;
function schedulePreview(): void {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(356 * dpr);
    const pixelRatio = width / recipe.canvas.width;
    const height = Math.max(1, Math.round(recipe.canvas.height * pixelRatio));
    preview.width = width;
    preview.height = height;
    try {
      const result = renderRecipe(recipe, { width, height, pixelRatio, transparent: true });
      preview.getContext('2d')?.putImageData(new ImageData(result.data, width, height), 0, 0);
    } catch (error) {
      setStatus(`Preview failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });
}

// ---- Recipe editing ---------------------------------------------------------

/** The top-most supported layer gets basic controls in the plugin. */
function primaryLayer(): Layer | undefined {
  return [...recipe.layers].reverse().find((l) => getLayerDefinition(l.type));
}

function updateLayer(id: string, patch: (layer: Layer) => Layer): void {
  recipe = { ...recipe, layers: recipe.layers.map((l) => (l.id === id ? patch(l) : l)) };
  schedulePreview();
}

function control(layer: Layer, def: ParamDef): HTMLElement {
  const wrap = document.createElement('label');
  const head = document.createElement('span');
  head.className = 'control-head';
  head.textContent = def.label;
  wrap.append(head);
  const value = layer.parameters[def.id] as ParamValue;
  const set = (v: ParamValue) => updateLayer(layer.id, (l) => ({ ...l, parameters: { ...l.parameters, [def.id]: v } }));

  if (def.kind === 'number') {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(value);
    const readout = document.createElement('span');
    const show = (v: number) => (readout.textContent = def.unit === '%' ? `${Math.round(v * 100)}%` : `${v}${def.unit ?? ''}`);
    show(Number(value));
    head.append(readout);
    input.addEventListener('input', () => {
      show(Number(input.value));
      set(Number(input.value));
    });
    wrap.append(input);
  } else if (def.kind === 'color') {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = String(value).toLowerCase();
    input.addEventListener('input', () => set(input.value.toUpperCase()));
    wrap.append(input);
  } else if (def.kind === 'boolean') {
    wrap.classList.add('radio');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value === true;
    input.addEventListener('change', () => {
      set(input.checked);
      buildControls();
    });
    wrap.prepend(input);
  } else {
    const select = document.createElement('select');
    for (const o of def.options) select.append(new Option(o.label, o.value, false, o.value === value));
    select.addEventListener('change', () => {
      set(select.value);
      buildControls();
    });
    wrap.append(select);
  }
  return wrap;
}

function buildControls(): void {
  controls.replaceChildren();
  const layer = primaryLayer();
  if (!layer) return;
  const def = getLayerDefinition(layer.type)!;
  const params = def.params.filter((p) => p.section !== 'advanced' && isParamVisible(p, layer.parameters)).slice(0, 6);
  const title = document.createElement('p');
  title.className = 'note';
  title.textContent = `${layer.name} — basic controls. Full layer editing is in the Material Lab web app.`;
  controls.append(title, ...params.map((p) => control(layer, p)));
}

function loadRecipe(next: Recipe): void {
  recipe = next;
  seedInput.value = String(recipe.seed);
  // Default output size: the recipe canvas, scaled down to Figma's limit if needed.
  const k = Math.min(1, FIGMA_MAX_IMAGE_SIDE / Math.max(recipe.canvas.width, recipe.canvas.height));
  widthInput.value = String(Math.round(recipe.canvas.width * k));
  heightInput.value = String(Math.round(recipe.canvas.height * k));
  buildControls();
  validateSize();
  schedulePreview();
}

// ---- Output size ----------------------------------------------------------------

function outputSize(): { width: number; height: number; scale: number; error: string | null } {
  const width = Number(widthInput.value);
  const height = Number(heightInput.value);
  const scale = Number(scaleSelect.value);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16) {
    return { width, height, scale, error: 'Enter whole-number dimensions of at least 16 px.' };
  }
  if (width * scale > FIGMA_MAX_IMAGE_SIDE || height * scale > FIGMA_MAX_IMAGE_SIDE) {
    const k = FIGMA_MAX_IMAGE_SIDE / (Math.max(width, height) * scale);
    return {
      width,
      height,
      scale,
      error: `Figma accepts images up to ${FIGMA_MAX_IMAGE_SIDE} px per side. Try ${Math.floor(width * k)} × ${Math.floor(height * k)} at ${scale}×${scale > 1 ? ', or 1× scale' : ''}.`,
    };
  }
  return { width, height, scale, error: null };
}

function validateSize(): void {
  const { error } = outputSize();
  sizeError.textContent = error ?? '';
  sizeError.classList.toggle('hidden', !error);
  insertButton.disabled = busy || error !== null;
}

// ---- Insertion -----------------------------------------------------------------------

async function renderPng(width: number, height: number, scale: number, onProgress: (p: number) => void): Promise<Uint8Array> {
  const W = width * scale;
  const H = height * scale;
  const pixels = new Uint8ClampedArray(W * H * 4);
  const rows = 128;
  for (let start = 0; start < H; start += rows) {
    const end = Math.min(H, start + rows);
    const chunk = renderRecipe(recipe, { width: W, height: H, pixelRatio: scale, rows: { start, end } });
    pixels.set(chunk.data, start * W * 4);
    onProgress(end / H);
    // Yield so the UI stays responsive during large renders.
    await new Promise((r) => setTimeout(r, 0));
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, W, H), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The image could not be encoded.');
  return new Uint8Array(await blob.arrayBuffer());
}

async function insert(): Promise<void> {
  const size = outputSize();
  if (size.error || busy) return;
  busy = true;
  validateSize();
  try {
    const bytes = await renderPng(size.width, size.height, size.scale, (p) => setStatus(`Rendering… ${Math.round(p * 100)}%`));
    setStatus('Inserting…');
    const mode = (document.querySelector<HTMLInputElement>('input[name=mode]:checked')?.value ?? 'new') as InsertMode;
    send({
      type: 'insert',
      bytes,
      width: size.width,
      height: size.height,
      name: recipe.name,
      mode,
      reference: {
        recipe,
        engineVersion: ENGINE_VERSION,
        output: { width: size.width * size.scale, height: size.height * size.scale, scale: size.scale },
        insertedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    busy = false;
    validateSize();
    setStatus(`Render failed: ${error instanceof Error ? error.message : String(error)}. Your settings are unchanged; try a smaller size.`, true);
  }
}

// ---- Selection and messages ------------------------------------------------------------

function renderSelection(): void {
  fillRadio.disabled = selection.fillable === 0;
  fillLabel.textContent =
    selection.fillable > 0
      ? `Image fill on ${selection.fillable} selected layer${selection.fillable === 1 ? '' : 's'} (replaces their fills)`
      : selection.count > 0
        ? 'Image fill — the selection cannot take an image fill'
        : 'Image fill on selected layers — nothing selected';
  if (fillRadio.disabled && fillRadio.checked) {
    document.querySelector<HTMLInputElement>('input[name=mode][value=new]')!.checked = true;
  }

  const ref = selection.reference;
  referenceBox.classList.toggle('hidden', !ref);
  referenceBox.replaceChildren();
  if (ref) {
    const text = document.createElement('p');
    text.className = 'note';
    text.textContent = `The selected layer is a rendered image of “${ref.recipe.name}” (seed ${ref.recipe.seed}, engine ${ref.engineVersion}). Load its recipe to adjust and re-render it.`;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Load recipe';
    button.addEventListener('click', () => {
      const result = parseRecipeJson(JSON.stringify(ref.recipe));
      if (result.ok) {
        loadRecipe(result.recipe);
        setStatus(`Loaded “${result.recipe.name}” from the selection.`);
      } else setStatus('The stored recipe could not be read.', true);
    });
    referenceBox.append(text, button);
  }
}

window.onmessage = (event: MessageEvent) => {
  const message = (event.data as { pluginMessage?: PluginToUi }).pluginMessage;
  if (!message) return;
  if (message.type === 'selection') {
    selection = message.info;
    renderSelection();
  } else if (message.type === 'inserted') {
    busy = false;
    validateSize();
    setStatus(message.mode === 'fill' ? `Filled ${message.count} layer${message.count === 1 ? '' : 's'} with the rendered image.` : 'Inserted as an image-filled rectangle.');
  } else if (message.type === 'insert-error') {
    busy = false;
    validateSize();
    setStatus(`Insert failed: ${message.message}`, true);
  }
};

// ---- Setup ------------------------------------------------------------------------------

for (const family of FAMILY_IDS) {
  const group = document.createElement('optgroup');
  group.label = FAMILY_LABELS[family];
  for (const p of PRESETS.filter((x) => x.family === family)) group.append(new Option(p.name, p.id));
  presetSelect.append(group);
}
presetSelect.addEventListener('change', () => {
  const preset = PRESETS.find((p) => p.id === presetSelect.value);
  if (preset) loadRecipe(instantiatePreset(preset));
});

seedInput.addEventListener('change', () => {
  const n = Number(seedInput.value);
  if (!Number.isFinite(n) || n < 0) {
    seedInput.value = String(recipe.seed);
    setStatus('Seed must be a whole number of 0 or more.', true);
    return;
  }
  recipe = { ...recipe, seed: normalizeSeed(n) };
  seedInput.value = String(recipe.seed);
  schedulePreview();
});

$<HTMLButtonElement>('variation').addEventListener('click', () => {
  recipe = { ...recipe, seed: randomSeed() };
  seedInput.value = String(recipe.seed);
  schedulePreview();
});

$<HTMLButtonElement>('import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  const result = parseRecipeJson(await file.text());
  if (!result.ok) {
    setStatus(`Can’t open this recipe: ${result.errors.map((e) => e.message).join(' ')}`, true);
    return;
  }
  loadRecipe(result.recipe);
  setStatus(result.warnings.length ? `Opened with ${result.warnings.length} compatibility note(s).` : `Opened “${result.recipe.name}”.`);
});

for (const el of [widthInput, heightInput, scaleSelect]) el.addEventListener('input', validateSize);
insertButton.addEventListener('click', () => void insert());

loadRecipe(recipe);
send({ type: 'ready' });
