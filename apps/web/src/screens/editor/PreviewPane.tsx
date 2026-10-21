import { isSeamless, type Recipe } from '@material-lab/engine';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { durationClass, track } from '../../lib/analytics';
import { PREVIEW_BUDGET, updateSettings, useSettings } from '../../lib/settings';
import { getRenderPool } from '../../render/pool';
import { PreviewScheduler, type PreviewFrame, type PreviewStatus } from '../../render/preview';

export type Zoom = 'fit' | number;
export type PreviewBackground = 'checker' | 'light' | 'dark';

interface PreviewPaneProps {
  recipe: Recipe;
  zoom: Zoom;
  background: PreviewBackground;
  /** Show the texture repeated 3 × 3 to check how it tiles. */
  tiling: boolean;
  /** Recipe to show on the left of a before/after split, or null. */
  compareWith: Recipe | null;
  onAddLayer: () => void;
  /** Reports the on-screen scale (CSS px per logical px), e.g. for a zoom label. */
  onScaleChange?: (scale: number) => void;
}

const PADDING = 48;

/** Quantize to 1/8-octave steps so small resizes do not trigger re-renders. */
function quantize(ratio: number): number {
  return 2 ** (Math.round(Math.log2(ratio) * 8) / 8);
}

let lastTracked = 0;

export function PreviewPane({ recipe, zoom, background, tiling, compareWith, onAddLayer, onScaleChange }: PreviewPaneProps) {
  const settings = useSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<PreviewFrame | null>(null);
  const [status, setStatus] = useState<PreviewStatus>({ state: 'idle' });
  const schedulerRef = useRef<PreviewScheduler | null>(null);
  const layerCount = useRef(recipe.layers.length);
  layerCount.current = recipe.layers.length;
  const { width: W, height: H } = recipe.canvas;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const scheduler = new PreviewScheduler(getRenderPool(), setFrame, setStatus);
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, []);

  const fitScale = box.width > 0 ? Math.max(0.02, Math.min((box.width - PADDING) / W, (box.height - PADDING) / H)) : 0;
  const cssScale = zoom === 'fit' ? fitScale : zoom;

  useEffect(() => {
    if (cssScale > 0) onScaleChange?.(cssScale);
  }, [cssScale, onScaleChange]);

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const budget = PREVIEW_BUDGET[settings.previewQuality];
  const targetRatio = useMemo(() => {
    if (cssScale <= 0) return 0;
    const wanted = cssScale * dpr;
    const cap = Math.sqrt(budget / (W * H));
    return quantize(Math.min(wanted, cap, 4));
  }, [cssScale, dpr, budget, W, H]);

  const hasVisibleLayers = recipe.layers.some((l) => l.enabled && l.opacity > 0);

  useEffect(() => {
    if (targetRatio <= 0) return;
    schedulerRef.current?.update({
      recipe,
      pixelRatio: targetRatio,
      transparent: recipe.canvas.transparentBackground,
      background: '#FFFFFF',
      tile: isSeamless(recipe),
    });
  }, [recipe, targetRatio]);

  // Paint frames (repeated 3 × 3 for the tiling preview).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;
    canvas.width = frame.data.width;
    canvas.height = frame.data.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (tiling) {
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = frame.data.width;
      tileCanvas.height = frame.data.height;
      tileCanvas.getContext('2d')?.putImageData(frame.data, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      const tw = canvas.width / 3;
      const th = canvas.height / 3;
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) ctx.drawImage(tileCanvas, i * tw, j * th, tw, th);
    } else {
      ctx.putImageData(frame.data, 0, 0);
    }
    if (frame.kind === 'full' && performance.now() - lastTracked > 3000) {
      lastTracked = performance.now();
      track('preview_render_completed', {
        render_mode: frame.kind,
        layer_count: layerCount.current,
        duration_class: durationClass(frame.ms),
        duration_ms: Math.round(frame.ms),
        success: true,
      });
    }
  }, [frame, tiling]);

  // Frame may come from an older canvas size; always display at the current size.
  const displayW = Math.round(W * cssScale);
  const displayH = Math.round(H * cssScale);
  const resolution = frame ? Math.round(frame.pixelRatio * 100) : null;
  const transparent = recipe.canvas.transparentBackground;
  const warnings = frame?.warnings ?? [];

  return (
    <div
      ref={containerRef}
      className={`preview-pane ${zoom === 'fit' ? 'preview-fit' : 'preview-zoomed'}`}
      aria-label="Texture preview"
      role="region"
    >
      <div className="preview-scroller">
        <div
          className={`preview-stage ${transparent ? `bg-${background}` : ''}`}
          style={{ width: displayW || undefined, height: displayH || undefined }}
        >
          <canvas
            ref={canvasRef}
            className="preview-canvas"
            role="img"
            aria-label={tiling ? `Tiling preview of ${recipe.name}, repeated three by three` : `Preview of ${recipe.name}, ${W} by ${H} pixels`}
            style={{ width: displayW || undefined, height: displayH || undefined, imageRendering: cssScale * dpr > (frame?.pixelRatio ?? 1) * 1.5 ? 'pixelated' : 'auto' }}
          />
          {compareWith && (
            <ComparePanel recipe={compareWith} targetRatio={targetRatio} tiling={tiling} width={displayW} height={displayH} />
          )}
          {!hasVisibleLayers && !compareWith && (
            <div className="preview-empty">
              {recipe.layers.length === 0 ? (
                <>
                  <p>
                    <strong>This recipe has no layers yet.</strong>
                  </p>
                  <p className="muted">Add a base color, then stack textures such as grain or paper on top.</p>
                  <button type="button" className="btn btn-primary" onClick={onAddLayer}>
                    <Icon name="plus" />
                    Add a layer
                  </button>
                </>
              ) : (
                <p>
                  <strong>All layers are hidden.</strong> Show a layer to see the texture.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="preview-status" aria-live="polite">
        {status.state === 'rendering' && (
          <span className="status-chip">
            <span className="spinner" aria-hidden="true" />
            {status.kind === 'draft' ? 'Rendering draft…' : 'Rendering…'}
          </span>
        )}
        {tiling && (
          <span className="status-chip subtle" title={isSeamless(recipe) ? 'Seamless tile repeated 3 × 3' : 'Seamless tile is off, so edges may show seams'}>
            Tiling 3 × 3{isSeamless(recipe) ? '' : ' · seamless off'}
          </span>
        )}
        {resolution !== null && status.state !== 'error' && (
          <span
            className="status-chip subtle"
            title="Preview resolution relative to a 1× export. Exports always render at full quality."
          >
            Preview · {frame?.kind === 'draft' ? 'draft ' : ''}
            {resolution}%
          </span>
        )}
      </div>

      {status.state === 'error' && (
        <div className="preview-error callout callout-error" role="alert">
          <Icon name="warning" />
          <div className="stack-tight">
            <p>
              <strong>The preview could not be rendered.</strong> {frame ? 'The last successful preview is shown. ' : ''}Your settings are unchanged.
            </p>
            <p className="muted small">{status.message}</p>
            <div className="button-row">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => schedulerRef.current?.retry()}>
                Retry
              </button>
              {settings.previewQuality !== 'draft' && (
                <button type="button" className="btn btn-ghost btn-small" onClick={() => updateSettings({ previewQuality: 'draft' })}>
                  Use draft preview quality
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="preview-warnings callout callout-warning" role="status">
          <Icon name="warning" />
          <ul>
            {warnings.map((w) => (
              <li key={w.layerId}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * "Before" half of the before/after split: the comparison recipe rendered on
 * top of the preview, clipped to the left of a draggable divider.
 */
function ComparePanel({ recipe, targetRatio, tiling, width, height }: { recipe: Recipe; targetRatio: number; tiling: boolean; width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState<PreviewFrame | null>(null);
  const [split, setSplit] = useState(50);
  const schedulerRef = useRef<PreviewScheduler | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scheduler = new PreviewScheduler(getRenderPool(), setFrame, () => undefined);
    schedulerRef.current = scheduler;
    return () => scheduler.dispose();
  }, []);

  useEffect(() => {
    if (targetRatio <= 0) return;
    schedulerRef.current?.update({
      recipe,
      pixelRatio: targetRatio,
      transparent: recipe.canvas.transparentBackground,
      background: '#FFFFFF',
      tile: isSeamless(recipe),
    });
  }, [recipe, targetRatio]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;
    canvas.width = frame.data.width;
    canvas.height = frame.data.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (tiling) {
      const t = document.createElement('canvas');
      t.width = frame.data.width;
      t.height = frame.data.height;
      t.getContext('2d')?.putImageData(frame.data, 0, 0);
      const tw = canvas.width / 3;
      const th = canvas.height / 3;
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) ctx.drawImage(t, i * tw, j * th, tw, th);
    } else {
      ctx.putImageData(frame.data, 0, 0);
    }
  }, [frame, tiling]);

  const moveTo = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSplit(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <div ref={stageRef} className="compare-layer" style={{ width, height }}>
      <canvas
        ref={canvasRef}
        className="preview-canvas compare-canvas"
        style={{ width, height, clipPath: `inset(0 ${100 - split}% 0 0)` }}
        role="img"
        aria-label={`Before: ${recipe.name}`}
      />
      <span className="compare-label before" style={{ opacity: split > 12 ? 1 : 0 }}>
        Before
      </span>
      <span className="compare-label after" style={{ opacity: split < 88 ? 1 : 0 }}>
        After
      </span>
      <div
        className="compare-divider"
        style={{ left: `${split}%` }}
        role="slider"
        tabIndex={0}
        aria-label="Before/after divider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split)}
        aria-valuetext={`${Math.round(split)}% before`}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          moveTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if ((e.target as HTMLElement).hasPointerCapture(e.pointerId)) moveTo(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setSplit((v) => Math.max(0, v - 5));
          if (e.key === 'ArrowRight') setSplit((v) => Math.min(100, v + 5));
          if (e.key === 'Home') setSplit(0);
          if (e.key === 'End') setSplit(100);
        }}
      >
        <span className="compare-handle" aria-hidden="true">
          ⟷
        </span>
      </div>
    </div>
  );
}
