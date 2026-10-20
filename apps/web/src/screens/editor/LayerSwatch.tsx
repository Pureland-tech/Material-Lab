import { getLayerDefinition } from '@material-lab/engine';

/** Small family-coded tile that identifies a layer's type in lists. */
export function LayerSwatch({ type }: { type: string }) {
  const def = getLayerDefinition(type);
  const key = def ? (def.family ?? 'base') : 'unknown';
  return (
    <span className={`layer-swatch swatch-${key}`} aria-hidden="true">
      {def ? def.label.charAt(0) : '?'}
    </span>
  );
}
