import { describe, expect, it } from 'vitest';
import { analyzeVector, createLayer, createRecipe, imageSvg, renderVectorSvg, sanitizeFilename, validateExportSettings } from '../src';

describe('SVG export', () => {
  const gradient = createRecipe({
    name: 'Brand <gradient>',
    width: 400,
    height: 200,
    layers: [
      createLayer('base-color', { parameters: { fill: 'linear', color: '#112233', color2: '#AABBCC', angle: 0 } }),
      createLayer('base-color', { opacity: 0.5, parameters: { fill: 'radial', color: '#FFFFFF', color2: '#000000' } }),
    ],
  });

  it('allows vector output only for base colors with normal blending', () => {
    expect(analyzeVector(gradient).vector).toBe(true);
    const textured = createRecipe({ layers: [createLayer('base-color'), createLayer('grain')] });
    const support = analyzeVector(textured);
    expect(support.vector).toBe(false);
    expect(support.reason).toContain('grain');
    const blended = createRecipe({ layers: [createLayer('base-color', { blendMode: 'multiply' })] });
    expect(analyzeVector(blended).vector).toBe(false);
  });

  it('writes gradients with the renderer geometry and escapes text', () => {
    const svg = renderVectorSvg(gradient, { width: 800, height: 400, transparent: true, background: '#FFFFFF' });
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"');
    // 0° spans left edge to right edge.
    expect(svg).toContain('x1="0" y1="0.5" x2="1" y2="0.5"');
    expect(svg).toContain('<radialGradient');
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain('Brand &lt;gradient&gt;');
    expect(svg).not.toContain('fill="#FFFFFF"/>');
    const opaque = renderVectorSvg(gradient, { width: 10, height: 10, transparent: false, background: '#FAFAFA' });
    expect(opaque).toContain('<rect width="100%" height="100%" fill="#FAFAFA"/>');
  });

  it('refuses vector output for raster textures and labels image SVGs honestly', () => {
    const textured = createRecipe({ layers: [createLayer('noise')] });
    expect(() => renderVectorSvg(textured, { width: 10, height: 10, transparent: true, background: '#FFF' })).toThrow();
    expect(imageSvg(textured, 'AAAA', 10, 10)).toContain('not editable vector');
    const v = validateExportSettings(textured, {
      format: 'svg',
      width: 100,
      height: 100,
      scale: 1,
      transparent: false,
      background: '#FFFFFF',
      quality: 0.9,
      filename: 'x.svg',
    });
    expect(v.valid).toBe(true);
    expect(v.warnings.some((w) => w.includes('Not a vector SVG'))).toBe(true);
    expect(sanitizeFilename('texture.png', 'svg')).toBe('texture.svg');
  });
});
