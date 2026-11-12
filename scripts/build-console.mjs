/** The settings-window build shared by staging and the portable source launcher. */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const dependencies = ['esbuild', '@tailwindcss/cli', 'tailwindcss', 'react', 'react-dom', 'react-textarea-autosize', '@codemirror/commands', '@codemirror/state', '@codemirror/view'];
function checkDependencies() {
  for (const name of dependencies) require.resolve(name === '@tailwindcss/cli' ? join(ROOT, 'node_modules', name, 'dist', 'index.mjs') : name);
}
export async function buildConsole(corticoRoot) {
  corticoRoot = corticoRoot ? resolve(corticoRoot) : undefined;
  if (corticoRoot && !existsSync(join(corticoRoot, 'src', 'core', 'language.ts'))) {
    throw new Error(`Cortico source is missing: ${corticoRoot}`);
  }
  checkDependencies();
  const esbuild = await import('esbuild');
  const WINDOW = join(ROOT, 'console');
  const WINDOW_OUT = join(ROOT, 'build', 'console');
  const pet = join(ROOT, 'packages', 'cortico-world-desktop-pet');
  const cli = join(ROOT, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');
  // the settings window: one ES module bundle (the CSS it imports becomes index.css), its stylesheet, the page.
  // The version and the build's channel (COOPANION_CHANNEL as scripts/pack.ts writes it into the app, github
  // by default) go in for the release check in the title bar.
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  rmSync(WINDOW_OUT, { recursive: true, force: true });
  mkdirSync(WINDOW_OUT, { recursive: true });
  await esbuild.build({
    entryPoints: [join(WINDOW, 'index.ts')],
    outdir: WINDOW_OUT,
    entryNames: 'index',
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    ...(corticoRoot ? { alias: { cortico: join(corticoRoot, 'src') } } : {}),
    minify: true,
    sourcemap: true,
    jsx: 'automatic',
    define: {
      COOPANION_VERSION: JSON.stringify(version),
      COOPANION_CHANNEL: JSON.stringify(process.env.COOPANION_CHANNEL === 'steam' ? 'steam' : 'github'),
      'process.env.NODE_ENV': '"production"',
    },
    logLevel: 'warning',
  });
  cpSync(join(WINDOW, 'index.html'), join(WINDOW_OUT, 'index.html'));
  const slash = (path) => relative(WINDOW_OUT, path).split(sep).join('/');
  const windowEntry = join(WINDOW_OUT, 'tailwind.entry.css');
  writeFileSync(windowEntry, [
    ...['styles.css', 'features/home/home.css', 'features/chat/chat.css', 'companion.css'].map((f) => `@import "${slash(join(WINDOW, f))}";`),
    `@source "${slash(WINDOW)}";`,
    `@source "${slash(join(pet, 'src', 'webui'))}";`,
    '',
  ].join('\n'));
  const windowCss = spawnSync(process.execPath, [cli, '-i', windowEntry, '-o', join(WINDOW_OUT, 'styles.css'), '--minify'], { cwd: WINDOW_OUT, stdio: 'inherit' });
  if (windowCss.status !== 0) throw new Error(`Settings stylesheet build failed (${windowCss.status}).`);
  rmSync(windowEntry);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    try { checkDependencies(); } catch (error) { console.error(error.message); process.exitCode = 2; }
  } else {
    const rootArgument = process.argv.indexOf('--cortico-root');
    const corticoRoot = rootArgument < 0 ? undefined : process.argv[rootArgument + 1];
    if (rootArgument >= 0 && (!corticoRoot || corticoRoot.startsWith('--'))) throw new Error('--cortico-root requires a directory.');
    await buildConsole(corticoRoot);
  }
}
