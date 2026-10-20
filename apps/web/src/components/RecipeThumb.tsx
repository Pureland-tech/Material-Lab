import type { Recipe } from '@material-lab/engine';
import { useEffect, useRef, useState } from 'react';
import { cachedThumbnail, renderThumbnail } from '../render/thumbnails';

interface RecipeThumbProps {
  recipe: Recipe;
  /** CSS width the thumbnail is designed for; rendered at device resolution. */
  width?: number;
  label: string;
  className?: string;
  onError?: () => void;
}

/** Lazily rendered preview of a recipe (renders when scrolled into view). */
export function RecipeThumb({ recipe, width = 320, label, className, onError }: RecipeThumbProps) {
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const px = Math.round(width * dpr);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>(() => (cachedThumbnail(recipe, px) ? 'ready' : 'idle'));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const draw = (data: ImageData) => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = data.width;
      canvas.height = data.height;
      canvas.getContext('2d')?.putImageData(data, 0, 0);
      setState('ready');
    };
    const hit = cachedThumbnail(recipe, px);
    if (hit) {
      draw(hit);
    } else {
      setState('loading');
      renderThumbnail(recipe, px).then(draw, () => {
        if (cancelled) return;
        setState('error');
        onErrorRef.current?.();
      });
    }
    return () => {
      cancelled = true;
    };
  }, [recipe, px, visible]);

  return (
    <div
      ref={wrapRef}
      className={`thumb ${recipe.canvas.transparentBackground ? 'thumb-transparent' : ''} ${className ?? ''}`}
      style={{ aspectRatio: `${recipe.canvas.width} / ${recipe.canvas.height}` }}
      role="img"
      aria-label={label}
    >
      <canvas ref={canvasRef} className={state === 'ready' ? 'thumb-canvas ready' : 'thumb-canvas'} />
      {state === 'loading' && <span className="thumb-shimmer" aria-hidden="true" />}
      {state === 'error' && <span className="thumb-error">Preview unavailable</span>}
    </div>
  );
}
