import { normalizeHex } from './color';
import { getLayerDefinition } from './layers';
import { slugify } from './recipe';
import { isSeamless } from './seamless';
import { analyzeVector } from './svg';
import { estimateRenderMemory, RENDER_LIMITS } from './render';
import type { ExportFormat, Recipe } from './types';
import { normalizeLayerParameters } from './validate';

export interface ExportSettings {
  format: ExportFormat;
  /** Logical size in px; output pixels are width × scale by height × scale. */
  width: number;
  height: number;
  scale: number;
  transparent: boolean;
  /** Background used when transparency is off (always for JPEG). */
  background: string;
  /** JPEG quality, 0.5–1. */
  quality: number;
  filename: string;
}

export const EXPORT_LIMITS = {
  minSide: 16,
  /** Maximum output side in pixels (after scale). */
  maxSide: RENDER_LIMITS.maxSide,
  /** Maximum output pixels (after scale). */
  maxPixels: 36_000_000,
  /** Above this, warn that the export may be slow. */
  warnPixels: 12_000_000,
  /** Above this estimated renderer memory, refuse and recommend a smaller size. */
  maxMemoryBytes: 1_500_000_000,
  warnMemoryBytes: 600_000_000,
  scales: [1, 2, 3, 4] as const,
  maxFilenameLength: 120,
} as const;

export interface DimensionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const DIMENSION_PRESETS: readonly DimensionPreset[] = [
  { id: 'card', label: 'UI card', width: 800, height: 500 },
  { id: 'square', label: 'Social square', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Social portrait', width: 1080, height: 1350 },
  { id: 'story', label: 'Story', width: 1080, height: 1920 },
  { id: 'hero', label: 'Web hero', width: 1920, height: 1080 },
  { id: 'wide', label: 'Wide banner', width: 2560, height: 1440 },
  { id: 'slide', label: 'Presentation', width: 1600, height: 900 },
  { id: '4k', label: '4K', width: 3840, height: 2160 },
];

export interface AlphaSupport {
  supported: boolean;
  /** Why transparency is unavailable, when it is not. */
  reason?: string;
}

/**
 * Transparency is only meaningful when no enabled layer covers the whole
 * canvas with opaque pixels at full opacity.
 */
export function analyzeAlpha(recipe: Recipe): AlphaSupport {
  for (const layer of recipe.layers) {
    if (!layer.enabled || layer.opacity < 1) continue;
    const def = getLayerDefinition(layer.type);
    if (!def) continue;
    const params = normalizeLayerParameters(def, layer.parameters).parameters;
    if (def.coversCanvas(params)) {
      return {
        supported: false,
        reason: `"${layer.name}" fills the whole canvas, so the export has no transparent areas. Lower its opacity, hide it, or use a layer with alpha output.`,
      };
    }
  }
  return { supported: true };
}

/** Lowercase, filesystem-safe filename with the correct extension. */
export function fileExtension(format: ExportFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

export function sanitizeFilename(name: string, format: ExportFormat): string {
  const ext = fileExtension(format);
  let base = name
    .trim()
    .replace(/\.(png|jpe?g|svg)$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  if (base.length > EXPORT_LIMITS.maxFilenameLength) base = base.slice(0, EXPORT_LIMITS.maxFilenameLength);
  return base ? `${base}.${ext}` : '';
}

export function defaultExportFilename(
  recipeName: string,
  settings: Pick<ExportSettings, 'width' | 'height' | 'scale' | 'format'>,
  tile = false,
): string {
  const suffix = settings.scale > 1 ? `@${settings.scale}x` : '';
  return sanitizeFilename(`${slugify(recipeName)}${tile ? '-tile' : ''}-${settings.width}x${settings.height}${suffix}`, settings.format);
}

export function defaultExportSettings(recipe: Recipe): ExportSettings {
  const d = recipe.exportDefaults;
  const alpha = analyzeAlpha(recipe);
  const format = d.format;
  const transparent = format === 'png' && recipe.canvas.transparentBackground && alpha.supported;
  const tile = isSeamless(recipe);
  const settings: ExportSettings = {
    format,
    // A seamless tile is the canvas.
    width: tile ? recipe.canvas.width : d.width,
    height: tile ? recipe.canvas.height : d.height,
    scale: d.scale,
    transparent,
    background: '#FFFFFF',
    quality: 0.92,
    filename: '',
  };
  settings.filename = defaultExportFilename(recipe.name, settings, tile);
  return settings;
}

/**
 * Rough file size range. Procedural textures compress poorly, so PNG sizes
 * sit near raw size; actual size depends on texture complexity.
 */
export function estimateFileSize(outputWidth: number, outputHeight: number, format: ExportFormat, transparent: boolean, quality = 0.92): { min: number; max: number } {
  const px = outputWidth * outputHeight;
  if (format === 'svg') {
    // Vector SVGs are tiny; image-backed SVGs are a base64 PNG (about 4/3 larger).
    const png = estimateFileSize(outputWidth, outputHeight, 'png', transparent);
    return { min: 400, max: Math.round(png.max * 1.37) };
  }
  if (format === 'jpeg') {
    const perPx = 0.12 + Math.max(0, quality - 0.5) * 1.6;
    return { min: Math.round(px * perPx * 0.35), max: Math.round(px * perPx) };
  }
  const channels = transparent ? 4 : 3;
  return { min: Math.round(px * channels * 0.25), max: Math.round(px * channels * 0.95) };
}

export interface ExportFieldError {
  field: 'width' | 'height' | 'scale' | 'format' | 'transparent' | 'filename' | 'background' | 'quality' | 'size';
  message: string;
}

export interface ExportValidation {
  valid: boolean;
  errors: ExportFieldError[];
  warnings: string[];
  outputWidth: number;
  outputHeight: number;
  estimatedMemoryBytes: number;
  estimatedFileSize: { min: number; max: number };
  alpha: AlphaSupport;
  /** A supported size to offer when the requested one is too large. */
  recommended?: { width: number; height: number; scale: number };
}

function recommend(width: number, height: number, scale: number): { width: number; height: number; scale: number } {
  // Prefer lowering the scale; otherwise shrink the size keeping the aspect ratio.
  for (let s = scale; s >= 1; s--) {
    const ow = width * s;
    const oh = height * s;
    if (ow <= EXPORT_LIMITS.maxSide && oh <= EXPORT_LIMITS.maxSide && ow * oh <= EXPORT_LIMITS.maxPixels) {
      return { width, height, scale: s };
    }
  }
  const k = Math.min(
    EXPORT_LIMITS.maxSide / width,
    EXPORT_LIMITS.maxSide / height,
    Math.sqrt(EXPORT_LIMITS.maxPixels / (width * height)),
  );
  return { width: Math.max(EXPORT_LIMITS.minSide, Math.floor(width * k)), height: Math.max(EXPORT_LIMITS.minSide, Math.floor(height * k)), scale: 1 };
}

export function validateExportSettings(recipe: Recipe, settings: ExportSettings): ExportValidation {
  const errors: ExportFieldError[] = [];
  const warnings: string[] = [];
  const alpha = analyzeAlpha(recipe);

  const sideOk = (v: number) => Number.isInteger(v) && v >= EXPORT_LIMITS.minSide;
  if (!sideOk(settings.width)) errors.push({ field: 'width', message: `Enter a whole number of at least ${EXPORT_LIMITS.minSide} px.` });
  if (!sideOk(settings.height)) errors.push({ field: 'height', message: `Enter a whole number of at least ${EXPORT_LIMITS.minSide} px.` });
  if (!(EXPORT_LIMITS.scales as readonly number[]).includes(settings.scale)) {
    errors.push({ field: 'scale', message: 'Choose a scale of 1×, 2×, 3× or 4×.' });
  }
  if (settings.format !== 'png' && settings.format !== 'jpeg' && settings.format !== 'svg') errors.push({ field: 'format', message: 'Choose PNG, JPEG or SVG.' });

  if (settings.transparent) {
    if (settings.format === 'jpeg') {
      errors.push({ field: 'transparent', message: 'JPEG cannot keep transparency. Choose PNG or turn transparency off.' });
    } else if (!alpha.supported) {
      errors.push({ field: 'transparent', message: alpha.reason ?? 'This composition has no transparent areas.' });
    }
  }
  if (!settings.transparent && !normalizeHex(settings.background)) {
    errors.push({ field: 'background', message: 'Enter a background color as a hex value, e.g. #FFFFFF.' });
  }
  if (settings.format === 'jpeg' && !(settings.quality >= 0.5 && settings.quality <= 1)) {
    errors.push({ field: 'quality', message: 'JPEG quality must be between 50% and 100%.' });
  }
  if (!sanitizeFilename(settings.filename, settings.format)) {
    errors.push({ field: 'filename', message: 'Enter a file name.' });
  }

  if (isSeamless(recipe) && (settings.width !== recipe.canvas.width || settings.height !== recipe.canvas.height)) {
    errors.push({
      field: 'size',
      message: `Seamless tiles export at the canvas size (${recipe.canvas.width} × ${recipe.canvas.height}). Use Scale for more pixels, or change the canvas size.`,
    });
  }

  const outputWidth = sideOk(settings.width) ? settings.width * settings.scale : 0;
  const outputHeight = sideOk(settings.height) ? settings.height * settings.scale : 0;
  let estimatedMemoryBytes = 0;
  let recommended: ExportValidation['recommended'];

  if (outputWidth > 0 && outputHeight > 0) {
    const tooBig =
      outputWidth > EXPORT_LIMITS.maxSide || outputHeight > EXPORT_LIMITS.maxSide || outputWidth * outputHeight > EXPORT_LIMITS.maxPixels;
    if (tooBig) {
      recommended = recommend(settings.width, settings.height, settings.scale);
      errors.push({
        field: 'size',
        message: `${outputWidth}×${outputHeight} px is larger than supported (max ${EXPORT_LIMITS.maxSide} px per side and ${EXPORT_LIMITS.maxPixels / 1_000_000} MP). Try ${recommended.width}×${recommended.height} at ${recommended.scale}×.`,
      });
    } else {
      estimatedMemoryBytes = estimateRenderMemory(recipe, outputWidth, outputHeight, settings.scale);
      if (estimatedMemoryBytes > EXPORT_LIMITS.maxMemoryBytes) {
        recommended = recommend(Math.floor(settings.width * 0.7), Math.floor(settings.height * 0.7), settings.scale);
        errors.push({
          field: 'size',
          message: `This export would need about ${Math.round(estimatedMemoryBytes / 1e6)} MB of memory. Reduce the size, scale or frosting.`,
        });
      } else if (estimatedMemoryBytes > EXPORT_LIMITS.warnMemoryBytes || outputWidth * outputHeight > EXPORT_LIMITS.warnPixels) {
        warnings.push('Large export: rendering may take a while and use a lot of memory.');
      }
    }
  }
  if (settings.format === 'svg') {
    const vector = analyzeVector(recipe);
    if (!vector.vector) {
      warnings.push(`Not a vector SVG: ${vector.reason} The SVG will contain the texture as an embedded PNG image.`);
    }
  }
  if (settings.format === 'jpeg' && alpha.supported && recipe.canvas.transparentBackground) {
    warnings.push(`JPEG has no transparency; transparent areas will be filled with ${settings.background.toUpperCase()}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    outputWidth,
    outputHeight,
    estimatedMemoryBytes,
    estimatedFileSize: estimateFileSize(outputWidth, outputHeight, settings.format, settings.transparent, settings.quality),
    alpha,
    recommended,
  };
}
