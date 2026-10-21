import { describe, expect, it } from 'vitest';
import {
  analyzeAlpha,
  createLayer,
  createRecipe,
  defaultExportFilename,
  defaultExportSettings,
  EXPORT_LIMITS,
  sanitizeFilename,
  setSeamless,
  validateExportSettings,
  type ExportSettings,
} from '../src';
import { sampleRecipe } from './helpers';

function settings(over: Partial<ExportSettings> = {}): ExportSettings {
  return { format: 'png', width: 1600, height: 1000, scale: 1, transparent: false, background: '#FFFFFF', quality: 0.92, filename: 'texture.png', ...over };
}

describe('export settings', () => {
  it('accepts sensible defaults', () => {
    const recipe = sampleRecipe();
    const s = defaultExportSettings(recipe);
    expect(s.filename).toBe('test-paper-320x200.png');
    const v = validateExportSettings(recipe, s);
    expect(v.valid).toBe(true);
    expect(v.outputWidth).toBe(320);
  });

  it('never allows JPEG with transparency', () => {
    const recipe = createRecipe({ layers: [createLayer('noise', { parameters: { alphaOutput: true } })] });
    const v = validateExportSettings(recipe, settings({ format: 'jpeg', transparent: true }));
    expect(v.valid).toBe(false);
    expect(v.errors[0]?.field).toBe('transparent');
  });

  it('explains when the composition has no transparent areas', () => {
    const recipe = sampleRecipe();
    expect(analyzeAlpha(recipe).supported).toBe(false);
    const v = validateExportSettings(recipe, settings({ transparent: true }));
    expect(v.errors[0]?.field).toBe('transparent');
    expect(v.errors[0]?.message).toContain('fills the whole canvas');
    // A semi-transparent top layer over nothing does support alpha.
    const overlay = createRecipe({ layers: [createLayer('grain', { opacity: 0.5 })] });
    expect(analyzeAlpha(overlay).supported).toBe(true);
  });

  it('rejects oversized output and recommends a supported size', () => {
    const v = validateExportSettings(sampleRecipe(), settings({ width: 4000, height: 4000, scale: 3 }));
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.field === 'size')).toBe(true);
    const rec = v.recommended!;
    expect(rec.width * rec.scale).toBeLessThanOrEqual(EXPORT_LIMITS.maxSide);
    expect(rec.width * rec.scale * rec.height * rec.scale).toBeLessThanOrEqual(EXPORT_LIMITS.maxPixels);
    expect(validateExportSettings(sampleRecipe(), settings(rec)).valid).toBe(true);
  });

  it('validates dimensions, scale and filename', () => {
    const v = validateExportSettings(sampleRecipe(), settings({ width: 0, height: 10.5, scale: 5, filename: '  ' }));
    expect(v.errors.map((e) => e.field).sort()).toEqual(['filename', 'height', 'scale', 'width']);
  });

  it('keeps seamless tiles at the canvas size', () => {
    const recipe = setSeamless(sampleRecipe(), true);
    const s = defaultExportSettings(recipe);
    expect(s.filename).toBe('test-paper-tile-320x200.png');
    expect(validateExportSettings(recipe, s).valid).toBe(true);
    const v = validateExportSettings(recipe, { ...s, width: 640 });
    expect(v.errors.some((e) => e.field === 'size' && e.message.includes('Seamless'))).toBe(true);
  });

  it('builds safe, meaningful filenames', () => {
    expect(defaultExportFilename('Warm Recycled Paper!', { width: 1600, height: 1000, scale: 2, format: 'jpeg' })).toBe('warm-recycled-paper-1600x1000@2x.jpg');
    expect(sanitizeFilename('../evil:name?.png', 'png')).toBe('evil-name.png');
    expect(sanitizeFilename('photo.PNG', 'jpeg')).toBe('photo.jpg');
    expect(sanitizeFilename('...', 'png')).toBe('');
  });

  it('estimates file size within a plausible range', () => {
    const v = validateExportSettings(sampleRecipe(), settings());
    expect(v.estimatedFileSize.min).toBeGreaterThan(0);
    expect(v.estimatedFileSize.max).toBeGreaterThan(v.estimatedFileSize.min);
    expect(v.estimatedFileSize.max).toBeLessThanOrEqual(1600 * 1000 * 3);
  });
});
