// Bundles the plugin: dist/code.js (Figma main thread) and dist/ui.html
// (UI iframe with its script inlined, as Figma requires a single HTML file).
import { context, build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist', { recursive: true });

const common = { bundle: true, target: 'es2020', logLevel: 'info', minify: !watch };

const writeUi = (js) => {
  const html = readFileSync('src/ui.html', 'utf8').replace('<!-- SCRIPT -->', `<script>${js.replace(/<\/script>/g, '<\\/script>')}</script>`);
  writeFileSync('dist/ui.html', html);
};

const uiOptions = {
  ...common,
  entryPoints: ['src/ui.ts'],
  format: 'iife',
  write: false,
  plugins: [
    {
      name: 'inline-ui',
      setup(b) {
        b.onEnd((result) => {
          if (result.errors.length === 0 && result.outputFiles?.[0]) writeUi(result.outputFiles[0].text);
        });
      },
    },
  ],
};
const codeOptions = { ...common, entryPoints: ['src/code.ts'], format: 'iife', outfile: 'dist/code.js' };

if (watch) {
  await (await context(codeOptions)).watch();
  await (await context(uiOptions)).watch();
} else {
  await build(codeOptions);
  await build(uiOptions);
}
