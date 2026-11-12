// SPDX-License-Identifier: AGPL-3.0-or-later
// Installs source-owned display files and migrates the portable adapter once.
import { readFile, writeFile, mkdir, rename, unlink, lstat, readlink, symlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const [appArg, projectArg, dataArg, disabled] = process.argv.slice(2);
if (!appArg || !projectArg || !dataArg) throw new Error('Expected app, project and data directories.');
const app = resolve(appArg), project = resolve(projectArg), data = resolve(dataArg);
const pet = join(app, 'node_modules/cortico-world-desktop-pet');
const packageName = 'cortico-world-codex-activity';
const target = join(app, 'node_modules', packageName);
const backups = join(app, '.ghost-bridge-originals');
const manifestFile = join(backups, 'world-installed.json');
const markerFile = join(data, 'integrations/codex-activity.json');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + String.fromCharCode(10));
async function optional(file) {
  try { return await readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}
const previous = JSON.parse((await optional(manifestFile))?.toString() || '{}');
const legacy = JSON.parse((await optional(join(backups, 'installed.json')))?.toString() || '{}');
const upstream = {
  'src/server.ts': '28cd6f71b973b1dbc1b243869730353da99e585f8e70e74ebe08f9bd5e6c7b02',
  'web/pet-app.js': '0fbe37943722e9ab0a5aef14cfca8fb52ac8001c1c01674d1723a87dfca4b62f',
  'web/pet.css': '10e65a10157f3da1e11f9d84200381eb2d92b4c9f0343c08ded016c6a3082c37',
  'host/electron-main.cjs': '3a7f23920fa4a3d9ec28f5e382a198b9449f57514556db495cb8b8e57a39cb9e',
  'core/guide.ts': '51e71354bec2b1d87fb0df89007f9dd89f381a133b561f2107d49e129c717d7f',
};
const writes = [], hashes = {};
async function plan(file, after, key, accepted = []) {
  const before = await optional(file);
  if (key && after) hashes[key] = sha(after);
  if ((before && after && before.equals(after)) || (!before && !after)) return;
  if (key && before && ![previous[key], ...accepted].includes(sha(before))) {
    throw new Error(`Unknown local runtime edits: ${file}. No files were changed.`);
  }
  writes.push({ file, before, after });
}
for (const name of ['src/server.ts', 'src/display.ts', 'src/asr.ts', 'web/pet-app.js', 'web/pet.css', 'web/displays.js', 'host/electron-main.cjs']) {
  await plan(join(pet, name), await readFile(join(project, 'packages/cortico-world-desktop-pet', name)),
    `pet/${name}`, [upstream[name], legacy[name]]);
}
const petPackageFile = join(pet, 'package.json');
const petPackage = JSON.parse(await readFile(petPackageFile, 'utf8'));
if (petPackage.exports?.['./display'] && petPackage.exports['./display'] !== './src/display.ts') {
  throw new Error('The runtime already defines a different desktop-pet/display export.');
}
if (petPackage.exports?.['./asr'] && petPackage.exports['./asr'] !== './src/asr.ts') {
  throw new Error('The runtime already defines a different desktop-pet/asr export.');
}
petPackage.exports = { ...petPackage.exports, './display': './src/display.ts', './asr': './src/asr.ts' };
await plan(petPackageFile, jsonBytes(petPackage));
const guideFile = join(app, 'core/guide.ts');
await plan(guideFile, await readFile(join(project, 'core/guide.ts')), 'core/guide.ts',
  [upstream['core/guide.ts'], legacy['core/guide.ts']]);
await plan(join(pet, 'web/codex-view.js'), null, 'legacy/view', [legacy['web/codex-view.js']]);
for (const name of ['package.json', 'describe.json', 'README.md', 'src/index.ts', 'src/definition.ts',
  'src/config.ts', 'src/world.ts', 'src/model-text.ts', 'src/activity.mjs', 'src/activity.d.mts', 'web/view.js', 'web/strings.js', 'web/strings.d.ts']) {
  await plan(join(target, name), await readFile(join(project, 'packages', packageName, name)), `world/${name}`);
}
const configFile = join(data, 'home/companion/config.json');
const extensionFile = join(data, 'extensions/package.json');
const config = JSON.parse(await readFile(configFile, 'utf8'));
const extensions = JSON.parse((await optional(extensionFile))?.toString() || '{"name":"cortico-extensions","private":true}');
const marker = await optional(markerFile);
const spec = `link:${target.replaceAll('\\', '/')}`;
const currentSpec = extensions.dependencies?.[packageName];
const owned = currentSpec === spec || (typeof currentSpec === 'string' && marker
  && currentSpec === JSON.parse(marker.toString()).spec);
if (!marker && currentSpec && !owned) throw new Error('A different Codex activity extension is already installed.');
let createLink = false;
let oldLink = null;
let linkCreated = false;
const link = join(data, 'extensions/node_modules', packageName);
if (!marker || owned) {
  try {
    const info = await lstat(link);
    if (!info.isSymbolicLink()) {
      throw new Error(`The extension link is not owned by this installer: ${link}`);
    }
    const currentTarget = resolve(await readlink(link));
    if (currentTarget.toLowerCase() !== target.toLowerCase()) {
      const oldSpec = marker && JSON.parse(marker.toString()).spec;
      if (typeof oldSpec !== 'string' || !oldSpec.startsWith('link:')
        || currentTarget.toLowerCase() !== resolve(oldSpec.slice(5)).toLowerCase()) {
        throw new Error(`The extension link is not owned by this installer: ${link}`);
      }
      oldLink = currentTarget;
      createLink = true;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; createLink = true; }
  extensions.dependencies = { ...extensions.dependencies, [packageName]: spec };
  await plan(extensionFile, jsonBytes(extensions));
}
if (!marker) {
  config.worlds ??= {};
  config.worlds['codex-activity'] = { enabled: disabled !== 'disabled', sessionsDir: process.env.GHOST_CODEX_SESSIONS_ROOT || '',
    pollMs: 400, maxThreads: 32, notifyOnComplete: true, ...config.worlds['codex-activity'] };
}
if (disabled === 'disabled' && (!marker || owned)) {
  config.worlds ??= {};
  config.worlds['codex-activity'] = { ...config.worlds['codex-activity'], enabled: false };
}
if (!marker || disabled === 'disabled') await plan(configFile, jsonBytes(config));
if (!marker || owned) await plan(markerFile, jsonBytes({ version: 1, spec }));

const recovery = join(backups, `world-migration-${Date.now()}`);
for (const [index, item] of writes.entries()) {
  await mkdir(dirname(item.file), { recursive: true });
  if (item.before) {
    await mkdir(recovery, { recursive: true });
    await writeFile(join(recovery, `${index}.bak`), item.before, { mode: 0o600 });
  }
  if (item.after) await writeFile(`${item.file}.world-pending`, item.after, { mode: 0o600 });
}
await mkdir(backups, { recursive: true });
if (writes.length) {
  await mkdir(recovery, { recursive: true });
  await writeFile(join(recovery, 'files.json'), jsonBytes(writes.map(({ file }, index) => ({ index, file }))));
}
const applied = [];
try {
  for (const item of writes) {
    if (item.after) await rename(`${item.file}.world-pending`, item.file);
    else await unlink(item.file);
    applied.push(item);
  }
  if (createLink) {
    await mkdir(dirname(link), { recursive: true });
    if (oldLink) await unlink(link);
    await symlink(target, link, 'junction');
    linkCreated = true;
  }
  await writeFile(`${manifestFile}.pending`, jsonBytes(hashes));
  await rename(`${manifestFile}.pending`, manifestFile);
} catch (error) {
  if (linkCreated) await unlink(link).catch(() => {});
  if (oldLink) await symlink(oldLink, link, 'junction').catch(() => {});
  const failed = [];
  for (const item of applied.reverse()) {
    try { if (item.before) await writeFile(item.file, item.before); else await unlink(item.file); }
    catch { failed.push(item.file); }
  }
  if (failed.length) throw new Error(`Migration failed. Restore from ${recovery}: ${failed.join(', ')}`, { cause: error });
  throw error;
} finally {
  for (const item of writes) await unlink(`${item.file}.world-pending`).catch(() => {});
}
console.log(JSON.stringify({ world: 'codex-activity', migrated: !marker, filesChanged: writes.length,
  installed: !marker || owned, enabled: config.worlds?.['codex-activity']?.enabled === true }));
