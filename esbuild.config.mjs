import { build, context } from 'esbuild';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const options = {
  entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian'], format: 'cjs',
  target: 'es2020', platform: 'browser', outfile: 'main.js', minify: true, logLevel: 'info',
  banner: { js: `/* Decision Review ${version} | MIT | yaml: ISC (see THIRD-PARTY-NOTICES.txt) */` }
};
if (process.argv.includes('--watch')) { const ctx = await context({ ...options, minify: false, sourcemap: 'inline' }); await ctx.watch(); }
else await build(options);
