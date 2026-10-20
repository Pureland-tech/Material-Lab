import type { LayerDefinition } from '../params';
import type { FamilyId, LayerType } from '../types';
import { baseColorLayer } from './base-color';
import { fabricLayer } from './fabric';
import { glassLayer } from './glass';
import { grainLayer } from './grain';
import { liquidLayer } from './liquid';
import { metallicLayer } from './metallic';
import { noiseLayer } from './noise';
import { paperLayer } from './paper';

export const LAYER_DEFINITIONS: Readonly<Record<LayerType, LayerDefinition>> = {
  'base-color': baseColorLayer,
  glass: glassLayer,
  grain: grainLayer,
  'paper-fiber': paperLayer,
  metallic: metallicLayer,
  fabric: fabricLayer,
  noise: noiseLayer,
  liquid: liquidLayer,
};

/** Layer types in the order they are offered in "Add layer". */
export const LAYER_TYPE_ORDER: readonly LayerType[] = [
  'base-color',
  'glass',
  'grain',
  'paper-fiber',
  'metallic',
  'fabric',
  'noise',
  'liquid',
];

export function getLayerDefinition(type: string): LayerDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(LAYER_DEFINITIONS, type)
    ? LAYER_DEFINITIONS[type as LayerType]
    : undefined;
}

export function isSupportedLayerType(type: string): type is LayerType {
  return getLayerDefinition(type) !== undefined;
}

export const FAMILY_LABELS: Record<FamilyId, string> = {
  glass: 'Glass',
  grain: 'Grain',
  paper: 'Paper',
  metallic: 'Metallic',
  fabric: 'Fabric',
  noise: 'Noise',
  liquid: 'Liquid',
};

export const FAMILY_DESCRIPTIONS: Record<FamilyId, string> = {
  glass: 'Frosted glass, translucent haze and soft reflective panels.',
  grain: 'Film grain and subtle analog texture.',
  paper: 'Paper fiber, recycled stock, pulp and print-inspired surfaces.',
  metallic: 'Brushed metal, chrome-inspired gradients and gold or silver finishes.',
  fabric: 'Linen, canvas, woven cloth and fine textile grain.',
  noise: 'Fine-grain overlays, dither-like textures and procedural fields.',
  liquid: 'Fluid distortion, marbling, flowing contours and organic swirls.',
};

export { baseColorLayer, fabricLayer, glassLayer, grainLayer, liquidLayer, metallicLayer, noiseLayer, paperLayer };
