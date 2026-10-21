/**
 * SVG export. Only compositions that SVG can represent exactly (base-color
 * layers: solid fills and linear/radial gradients, normal blending) become
 * vector SVG. Everything else is procedural raster texture: it can only be
 * delivered as an image inside an SVG, which is labelled as such and never
 * presented as editable vector (PRD FR-059).
 */
import { getLayerDefinition } from './layers';
import { direction } from './math';
import { normalizeLayerParameters } from './validate';
import type { Recipe } from './types';

export interface VectorSupport {
  vector: boolean;
  /** Why the recipe cannot be a vector SVG. */
  reason?: string;
}

export function analyzeVector(recipe: Recipe): VectorSupport {
  const visible = recipe.layers.filter((l) => l.enabled && l.opacity > 0);
  if (visible.length === 0) return { vector: false, reason: 'The recipe has no visible layers.' };
  for (const layer of visible) {
    if (layer.type !== 'base-color') {
      const label = getLayerDefinition(layer.type)?.label ?? layer.type;
      return { vector: false, reason: `“${layer.name}” is a ${label.toLowerCase()} texture, which is generated per pixel and cannot be drawn as vector shapes.` };
    }
    if (layer.blendMode !== 'normal') {
      return { vector: false, reason: `“${layer.name}” uses the ${layer.blendMode} blend mode, which SVG tools do not render consistently.` };
    }
  }
  return { vector: true };
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);
}

function num(v: number): string {
  return Number(v.toFixed(6)).toString();
}

export interface SvgOptions {
  /** Output size in px (logical size × scale). */
  width: number;
  height: number;
  transparent: boolean;
  background: string;
}

/** Vector SVG for recipes where analyzeVector() is true. Throws otherwise. */
export function renderVectorSvg(recipe: Recipe, options: SvgOptions): string {
  const support = analyzeVector(recipe);
  if (!support.vector) throw new Error(support.reason ?? 'This recipe cannot be exported as vector SVG.');
  const { width, height } = options;
  const defs: string[] = [];
  const shapes: string[] = [];
  if (!options.transparent) shapes.push(`<rect width="100%" height="100%" fill="${escapeXml(options.background)}"/>`);
  recipe.layers.forEach((layer, index) => {
    if (!layer.enabled || !(layer.opacity > 0)) return;
    const def = getLayerDefinition(layer.type)!;
    const p = normalizeLayerParameters(def, layer.parameters).parameters;
    const c1 = String(p.color);
    const c2 = String(p.color2);
    const opacity = layer.opacity < 1 ? ` opacity="${num(layer.opacity)}"` : '';
    let fill = c1;
    if (p.fill === 'linear') {
      // Same geometry as the raster renderer: the gradient spans corner to corner along the angle,
      // in bounding-box units (each axis normalized separately).
      const d = direction(Number(p.angle));
      const hs = Math.abs(d.x) * 0.5 + Math.abs(d.y) * 0.5;
      const id = `g${index}`;
      defs.push(
        `<linearGradient id="${id}" gradientUnits="objectBoundingBox" x1="${num(0.5 - d.x * hs)}" y1="${num(0.5 - d.y * hs)}" x2="${num(0.5 + d.x * hs)}" y2="${num(0.5 + d.y * hs)}"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`,
      );
      fill = `url(#${id})`;
    } else if (p.fill === 'radial') {
      const id = `g${index}`;
      defs.push(
        `<radialGradient id="${id}" gradientUnits="objectBoundingBox" cx="0.5" cy="0.5" r="${num(Math.SQRT1_2)}"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient>`,
      );
      fill = `url(#${id})`;
    }
    shapes.push(`<rect width="${width}" height="${height}" fill="${fill}"${opacity}><title>${escapeXml(layer.name)}</title></rect>`);
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${escapeXml(recipe.name)}</title>`,
    `<desc>Material Lab vector export · seed ${recipe.seed} · engine ${recipe.engineVersion}</desc>`,
    defs.length ? `<defs>${defs.join('')}</defs>` : '',
    ...shapes,
    '</svg>',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * An SVG file wrapping a rendered PNG. Clearly described as an image: the
 * texture is not editable as vector shapes.
 */
export function imageSvg(recipe: Recipe, pngBase64: string, width: number, height: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${escapeXml(recipe.name)}</title>`,
    `<desc>Material Lab texture as an embedded PNG image (not editable vector shapes) · seed ${recipe.seed} · engine ${recipe.engineVersion}</desc>`,
    `<image width="${width}" height="${height}" href="data:image/png;base64,${pngBase64}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

