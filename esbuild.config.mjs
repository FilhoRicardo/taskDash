import esbuild from 'esbuild';
import process from 'node:process';
import fs from 'node:fs';

const banner = `/*
TaskDash — bundled with esbuild.
Source: https://github.com/FilhoRicardo/task-dash-plugin
*/`;

const prod = process.argv[2] === 'production';

// Obsidian expects a single styles.css next to main.js. The app CSS is kept in
// plain files (scoped under .taskdash-root) and concatenated here.
const STYLE_FILES = ['src/plugin.css', 'src/app/index.css', 'src/app/glass.css'];
function buildStyles() {
  const css = STYLE_FILES.filter(f => fs.existsSync(f))
    .map(f => `/* ---- ${f} ---- */\n` + fs.readFileSync(f, 'utf8'))
    .join('\n\n');
  fs.writeFileSync('styles.css', css);
}

const stylePlugin = {
  name: 'taskdash-styles',
  setup(build) {
    build.onEnd(() => buildStyles());
  },
};

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  minify: prod,
  treeShaking: true,
  outfile: 'main.js',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': prod ? '"production"' : '"development"' },
  plugins: [stylePlugin],
});

if (prod) {
  await context.rebuild();
  await context.dispose();
  process.exit(0);
} else {
  await context.watch();
}
