import { analyzeAlpha, analyzeAnimation, ANIMATION_LIMITS, isSeamless, planAnimation, type Recipe } from '@material-lab/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NumberField, Segmented, Toggle } from '../../components/fields';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { dimensionClass, durationClass, track } from '../../lib/analytics';
import { downloadBlob, formatBytes, formatDuration } from '../../lib/format';
import {
  animationFilename,
  animationSize,
  renderPreviewFrames,
  runAnimationExport,
  type AnimationFormat,
  type AnimationOutput,
} from '../../render/animation';
import { isAbortError } from '../../render/pool';

interface AnimationDialogProps {
  recipe: Recipe;
  onClose: () => void;
}

const SIDES = [360, 480, 720, 1080] as const;
const PREVIEW_SIDE = 240;

type Phase =
  | { name: 'configure' }
  | { name: 'running'; done: number; total: number }
  | { name: 'done'; output: AnimationOutput; downloaded: boolean }
  | { name: 'error'; message: string };

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Looping preview of the animation at a small size. */
function AnimationPreview({ recipe, duration, motion, transparent }: { recipe: Recipe; duration: number; motion: number; transparent: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frames, setFrames] = useState<ImageData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const count = Math.max(10, Math.min(40, Math.round(duration * 10)));
  const size = animationSize(recipe, PREVIEW_SIDE);

  useEffect(() => {
    const controller = new AbortController();
    // Settle slider drags before rendering.
    const timer = window.setTimeout(() => {
      renderPreviewFrames(recipe, { longestSide: PREVIEW_SIDE, frames: count, motion, transparent, signal: controller.signal }).then(
        (result) => {
          setFrames(result);
          setError(null);
        },
        (e: unknown) => {
          if (!isAbortError(e)) setError(e instanceof Error ? e.message : String(e));
        },
      );
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [recipe, count, motion, transparent]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !frames || frames.length === 0) return;
    if (!playing) {
      ctx.putImageData(frames[0] as ImageData, 0, 0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const position = (((now - start) / 1000) % duration) / duration;
      ctx.putImageData(frames[Math.floor(position * frames.length) % frames.length] as ImageData, 0, 0);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [frames, playing, duration]);

  return (
    <div className="animation-preview">
      <div className={`animation-canvas${transparent ? ' thumb-transparent' : ''}`} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
        <canvas ref={canvasRef} width={size.width} height={size.height} aria-label="Animation preview" role="img" />
        {!frames && !error && <span className="animation-status muted small">Rendering preview…</span>}
        {error && <span className="animation-status small">Preview failed: {error}</span>}
      </div>
      <button type="button" className="btn btn-ghost btn-small" onClick={() => setPlaying((p) => !p)} disabled={!frames} aria-pressed={playing}>
        <Icon name={playing ? 'pause' : 'play'} />
        {playing ? 'Pause preview' : 'Play preview'}
      </button>
    </div>
  );
}

/** Export a seamless loop as an animated GIF or a ZIP of PNG frames. */
export function AnimationDialog({ recipe, onClose }: AnimationDialogProps) {
  const moving = useMemo(() => analyzeAnimation(recipe), [recipe]);
  const alpha = useMemo(() => analyzeAlpha(recipe), [recipe]);
  const tile = isSeamless(recipe);
  const [format, setFormat] = useState<AnimationFormat>('gif');
  const [side, setSide] = useState<number>(480);
  const [duration, setDuration] = useState(3);
  const [fps, setFps] = useState<number>(15);
  const [motion, setMotion] = useState(0.5);
  const [transparent, setTransparent] = useState(alpha.supported && recipe.canvas.transparentBackground);
  const [phase, setPhase] = useState<Phase>({ name: 'configure' });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const plan = planAnimation(duration, fps);
  const size = animationSize(recipe, side);
  const filename = animationFilename(recipe, format);
  const durationError =
    duration < ANIMATION_LIMITS.minDuration || duration > ANIMATION_LIMITS.maxDuration
      ? `Loop length must be ${ANIMATION_LIMITS.minDuration}–${ANIMATION_LIMITS.maxDuration} seconds.`
      : null;
  const capped = Math.round(duration * plan.fps) > ANIMATION_LIMITS.maxFrames;

  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ name: 'running', done: 0, total: plan.frames });
    track('export_started', { format, kind: 'animation' });
    try {
      const output = await runAnimationExport(
        recipe,
        { format, longestSide: side, duration, fps, motion, transparent: alpha.supported && transparent, background: '#FFFFFF' },
        { signal: controller.signal, onProgress: (done, total) => setPhase({ name: 'running', done, total }) },
      );
      const downloaded = downloadBlob(output.blob, output.filename);
      track('export_completed', {
        format,
        kind: 'animation',
        frames: output.frames,
        duration_class: durationClass(output.ms),
        file_size_class: dimensionClass(output.width, output.height),
      });
      setPhase({ name: 'done', output, downloaded });
    } catch (error) {
      if (isAbortError(error)) {
        setPhase({ name: 'configure' });
        return;
      }
      track('export_failed', { format, kind: 'animation', error_category: 'render' });
      setPhase({ name: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const running = phase.name === 'running';
  const nothingMoves = moving.length === 0;
  return (
    <Modal
      open
      title="Export animation"
      description="A seamless loop: the last frame leads back into the first."
      size="medium"
      dismissible={!running}
      onClose={onClose}
      footer={
        phase.name === 'configure' ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={nothingMoves || !!durationError}>
              <Icon name="download" />
              Export {format === 'gif' ? 'GIF' : 'frames'}
            </button>
          </>
        ) : running ? (
          <button type="button" className="btn btn-secondary" onClick={() => abortRef.current?.abort()}>
            Cancel export
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        )
      }
    >
      {phase.name === 'configure' && (
        <div className="animation-layout">
          <div className="stack">
            {nothingMoves ? (
              <p className="callout callout-info compact">
                <Icon name="info" />
                Nothing in this recipe moves. Liquid, noise, metallic, glass and grain layers animate; add one to export a loop.
              </p>
            ) : (
              <>
                <AnimationPreview recipe={recipe} duration={duration} motion={motion} transparent={alpha.supported && transparent} />
                <ul className="moving-list small" aria-label="Layers that move">
                  {moving.map((m) => (
                    <li key={m.layerId}>
                      <strong>{m.layerName}</strong> <span className="muted">— {m.motion}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="stack">
            <Segmented
              label="Format"
              value={format}
              options={[
                { value: 'gif', label: 'GIF' },
                { value: 'png-frames', label: 'PNG frames (ZIP)' },
              ]}
              onChange={setFormat}
            />
            <Segmented label="Longest side" value={side} options={SIDES.map((s) => ({ value: s as number, label: `${s}px` }))} onChange={setSide} />
            <NumberField label="Loop length" value={duration} min={ANIMATION_LIMITS.minDuration} max={ANIMATION_LIMITS.maxDuration} step={0.5} unit="s" onChange={setDuration} />
            <Segmented label="Frame rate" value={fps} options={ANIMATION_LIMITS.frameRates.map((r) => ({ value: r as number, label: `${r}` }))} onChange={setFps} />
            <NumberField label="Motion" value={motion} min={0} max={1} step={0.01} unit="%" onChange={setMotion} help="How far things move during one loop." />
            <Toggle
              label="Transparent background"
              checked={alpha.supported && transparent}
              disabled={!alpha.supported}
              description={
                !alpha.supported ? alpha.reason ?? 'This recipe has no transparent areas.' : format === 'gif' ? 'GIF transparency is on/off per pixel, so soft edges become hard.' : 'Keep uncovered areas transparent.'
              }
              onChange={setTransparent}
            />
            <p className="muted small" aria-live="polite">
              {plan.frames} frames · {size.width} × {size.height}px · {plan.fps.toFixed(plan.fps % 1 ? 1 : 0)} fps{tile ? ' · each frame tiles seamlessly' : ''}
            </p>
            {capped && (
              <p className="callout callout-warning compact">
                <Icon name="warning" />
                Limited to {ANIMATION_LIMITS.maxFrames} frames, so this loop plays for {(plan.frames / plan.fps).toFixed(1)}s.
              </p>
            )}
            {durationError && <p className="callout callout-error compact">{durationError}</p>}
          </div>
        </div>
      )}
      {running && (
        <div className="export-progress">
          <p>
            Rendering frame {Math.min(phase.done + 1, phase.total)} of {phase.total}…
          </p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={phase.total} aria-valuenow={phase.done} aria-label="Animation export progress">
            <div className="progress-bar" style={{ width: `${(phase.done / phase.total) * 100}%` }} />
          </div>
        </div>
      )}
      {phase.name === 'done' && (
        <div className="stack">
          <p className="callout callout-success compact">
            <Icon name="check" />
            {phase.downloaded ? 'Downloaded' : 'Ready'} {phase.output.filename} ({formatBytes(phase.output.blob.size)}, {phase.output.frames} frames, {phase.output.width} ×{' '}
            {phase.output.height}) in {formatDuration(phase.output.ms)}.
          </p>
          {!phase.downloaded && (
            <button type="button" className="btn btn-secondary" onClick={() => downloadBlob(phase.output.blob, filename)}>
              <Icon name="download" />
              Download {filename}
            </button>
          )}
        </div>
      )}
      {phase.name === 'error' && (
        <div className="callout callout-error" role="alert">
          <Icon name="warning" />
          <div className="stack-tight">
            <p>The animation did not export: {phase.message}</p>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setPhase({ name: 'configure' })}>
              Back to settings
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
