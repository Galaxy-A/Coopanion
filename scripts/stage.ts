/**
 * Builds what the app runs from source:
 *
 * 1. `build/cortico/`: `vendor/cortico` without the built-in platform Worlds (minecraft, qq, bilibili,
 *    websearch, the WebUI fixture), the llamacpp provider, the other bots, and repository tooling
 *    (`console` stays: core/companion.ts mounts it). Its `src/web/client` is vendor's as it is.
 *    Cortico's own `buildWeb` builds its WebUI and the panel bundles of the Persona and the
 *    built-in Worlds, which the settings window loads through the manifest; its stylesheet is built
 *    with Tailwind;
 * 2. the desktop pet World's panel bundle, which the settings window loads the same way;
 * 3. `build/panels/coopanion/`: the coopanion World's panel bundle (`core/webui/client.ts`), loaded the same way;
 * 4. `build/console/`: the settings window (`console/index.ts`, `console/index.html`), which the
 *    Electron main process serves under `/coopanion/` on Core's origin.
 *
 * Run: `pnpm run build:cortico`. Idempotent; the previous output is replaced.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VENDOR = join(ROOT, 'vendor', 'cortico');
const OUT = join(ROOT, 'build', 'cortico');
const WINDOW_OUT = join(ROOT, 'build', 'console');

if (!existsSync(join(VENDOR, 'src', 'core'))) {
  console.error('vendor/cortico 是空的:先运行 git submodule update --init --recursive');
  process.exit(1);
}

/** Paths under vendor/cortico that the app does not ship, relative, forward slashes. */
const DROP = new Set([
  '.git', '.github', 'node_modules', 'dist', 'tests', 'docs', 'scratch', 'deprecated', 'deployments', 'extensions',
  'runtime', 'templates', 'patches', 'scripts', 'bin', 'CortiV-DataAnalysis', 'assets',
  'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.web.json', 'vitest.config.ts', 'start.bat', 'start.sh',
  'AGENTS.md', 'CLAUDE.md', 'CODE_OF_CONDUCT.md', 'CONTRIBUTING.md', 'SECURITY.md', '.env', '.gitignore', '.gitattributes',
  'src/worlds/minecraft', 'src/worlds/qq', 'src/worlds/bilibili', 'src/worlds/websearch', 'src/worlds/webui-fixture',
  'src/providers/llamacpp',
  'bots/corti-soulmate', 'bots/cortiv',
]);

const t0 = Date.now();
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(VENDOR, OUT, {
  recursive: true,
  filter: (src) => {
    const rel = relative(VENDOR, src).split(sep).join('/');
    return rel === '' || !DROP.has(rel);
  },
});
// the staged tree is its own package: ESM, and the runtime dependencies resolve from the app root
writeFileSync(join(OUT, 'package.json'), JSON.stringify({ name: 'cortico', private: true, type: 'module' }, null, 2));
console.log(`staged Cortico ${Date.now() - t0} ms`);

const { buildWeb } = await import(pathToFileURL(join(VENDOR, 'scripts', 'build-web.ts')).href) as { buildWeb(root: string): Promise<unknown> };
await buildWeb(OUT);

// Tailwind skips git-ignored directories when it looks for class names, and build/ is ignored:
// name the sources explicitly.
const entry = join(OUT, 'tailwind.entry.css');
writeFileSync(entry, [
  '@import "./src/web/public/styles.css";',
  '@source "./src";',
  '@source "./bots";',
  '',
].join('\n'));
const cli = join(ROOT, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');
const css = spawnSync(process.execPath, [cli, '-i', entry, '-o', join(OUT, 'dist', 'web', 'styles.css'), '--minify'], { cwd: OUT, stdio: 'inherit' });
if (css.status !== 0) process.exit(css.status ?? 1);
rmSync(entry);

const pet = join(ROOT, 'packages', 'cortico-world-desktop-pet');
const panel = spawnSync(process.execPath, [join(pet, 'scripts', 'build-webui.mjs')], { cwd: pet, stdio: 'inherit' });
if (panel.status !== 0) process.exit(panel.status ?? 1);

const esbuild = await import('esbuild');
const PANELS_OUT = join(ROOT, 'build', 'panels', 'coopanion');
rmSync(PANELS_OUT, { recursive: true, force: true });
await esbuild.build({
  entryPoints: [{ in: join(ROOT, 'core', 'webui', 'client.ts'), out: 'webui' }],
  outdir: PANELS_OUT,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: true,
  sourcemap: true,
  logLevel: 'warning',
});

const settings = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-console.mjs')], { cwd: ROOT, stdio: 'inherit' });
if (settings.status !== 0) process.exit(settings.status ?? 1);

console.log(`stage done in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${relative(ROOT, OUT)}, ${relative(ROOT, WINDOW_OUT)}`);
