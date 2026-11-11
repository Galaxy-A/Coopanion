// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile, writeFile, mkdir, rename, unlink, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const [appRootArg, projectArg] = process.argv.slice(2);
if (!appRootArg || !projectArg) throw new Error('Expected app root and project root.');
const appRoot = resolve(appRootArg), project = resolve(projectArg);
const petRoot = join(appRoot, 'node_modules/cortico-world-desktop-pet');
const backups = join(appRoot, '.ghost-bridge-originals');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Exact hashes of our first adapter, so an in-session upgrade remains fail-closed.
const earlierAdapter = {
  'src/server.ts': '1522eac007eb93295566130e25af8aea198e17b290a654dcf8c7e7783ef93aa4',
  'web/pet-app.js': '2c4d1b1755c4a754b18c93385e3abe1e5c37846335922040ed172e35aab0ea9b',
};
const manifestFile = join(backups, 'installed.json');
let installed = {};
try { installed = JSON.parse(await readFile(manifestFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const replace = (text, before, after) => {
  if (text.split(before).length !== 2) throw new Error(`Adapter anchor is not unique: ${before.slice(0, 60)}`);
  return text.replace(before, after);
};
const changes = [
  {
    path: 'src/server.ts', hash: '28cd6f71b973b1dbc1b243869730353da99e585f8e70e74ebe08f9bd5e6c7b02',
    adapt(text) {
      text = replace(text, '  private boundPort = 0;', `  // GhostCompanion: display-only Codex bridge; no World chat/tool calls.
  private ghostBridge: any = null;
  private boundPort = 0;`);
      text = replace(text, '      return this.boundPort;', `      if (process.env.GHOST_CODEX_BRIDGE_MODULE) {
        try {
          const module = await import(process.env.GHOST_CODEX_BRIDGE_MODULE);
          this.ghostBridge = await module.attachCodexBridge({ send: (msg: PageMessage) => { if (this.petInWindow) this.sendPet(msg); } });
        } catch (error) { console.error('[ghost-codex] adapter unavailable', error); }
      }
      return this.boundPort;`);
      text = replace(text, '  async stop(): Promise<void> {', `  async stop(): Promise<void> {
    this.ghostBridge?.stop();
    this.ghostBridge = null;`);
      text = replace(text, "ws.send(JSON.stringify({ t: 'init', ...this.opts.snapshot() }));",
        "ws.send(JSON.stringify({ t: 'init', ...this.opts.snapshot(), ...(fromWindow ? { codexBridge: this.ghostBridge?.snapshot() } : {}) }));");
      return replace(text, "    if (req.method === 'GET' && path === '/api/state')", `    if (req.method === 'GET' && path === '/api/codex-bridge') return json(res, 200, this.ghostBridge?.status() ?? { enabled: false });
    if (req.method === 'GET' && path === '/api/state')`);
    },
  },
  {
    path: 'web/pet-app.js', hash: '0fbe37943722e9ab0a5aef14cfca8fb52ac8001c1c01674d1723a87dfca4b62f',
    adapt(text) {
      text = replace(text, "import { runFrames } from './frame-loop.js';",
        "import { runFrames } from './frame-loop.js';\nimport { createCodexDisplay } from './codex-view.js';");
      text = replace(text, 'const holdRoam = (seconds)', `const codex = createCodexDisplay({ bubble, body: () => body, nativeState: () => bodyState, icons: ICONS, requestFocus: () => host?.focus?.() });
const holdRoam = (seconds)`);
      text = replace(text, '    setStatus(null);', '    codex.disconnect();\n    setStatus(null);');
      text = replace(text, 'next.set({ roam: prefs.roam, ...bodyState });',
        'next.set({ roam: prefs.roam, ...codex.merge(bodyState) });');
      text = replace(text, "    case 'init': restorePosition",
        "    case 'codex': codex.receive(m); break;\n    case 'init': codex.receive(m.codexBridge); restorePosition");
      text = replace(text, '  body?.set(change);', '  body?.set(codex.merge(bodyState));');
      text = replace(text, "const UI_SELECTOR = '.bubble:not(.status)",
        "const UI_SELECTOR = '.ghost-codex-surface:not([hidden]), .bubble:not(.status)");
      text = replace(text, '  placeLines(a, sayBox, dt);', '  placeLines(a, sayBox, dt);\n  codex.layout(l);');
      text = replace(text, 'for (const el of [bubble, ...lines.map((l) => l.el)])',
        'for (const el of [bubble, ...codex.elements, ...lines.map((l) => l.el)])');
      text = replace(text, 'const covers = [bubble, ...(menu.hidden ? [] : menu.children)',
        'const covers = [bubble, ...codex.elements, ...(menu.hidden ? [] : menu.children)');
      return replace(text, 'function stepStatus() {', `function stepStatus() {
  codex.step({
    blocked: !!(listen.phase || item || queue.length || status.wanted),
    enabled: prefs.statusBubble,
  });`);
    },
  },
  {
    path: 'host/electron-main.cjs', hash: '3a7f23920fa4a3d9ec28f5e382a198b9449f57514556db495cb8b8e57a39cb9e',
    adapt(text) {
      text = replace(text, "const { join } = require('node:path');", `// A separate local inspector for the pet, only when the launcher explicitly enables Inspect.
if (/^\\d{1,5}$/.test(process.env.GHOST_PET_INSPECT_PORT || '') && Number(process.env.GHOST_PET_INSPECT_PORT) <= 65535) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.GHOST_PET_INSPECT_PORT);
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
}
const { join } = require('node:path');`);
      text = replace(text, 'fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false,',
        'fullscreenable: false, skipTaskbar: !process.env.GHOST_PET_INSPECT_PORT, hasShadow: false, show: false,');
      text = replace(text, "...(process.platform === 'win32' ? { type: 'toolbar' } : {}),",
        "...(process.platform === 'win32' && !process.env.GHOST_PET_INSPECT_PORT ? { type: 'toolbar' } : {}),");
      return replace(text, "      else if (/^https?:\\/\\//i.test(target)) void shell.openExternal(target);",
        "      else if (/^codex:\\/\\/threads\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) void shell.openExternal(target);\n      else if (/^https?:\\/\\//i.test(target)) void shell.openExternal(target);");
    },
  },
  {
    root: 'app', path: 'core/guide.ts', hash: '51e71354bec2b1d87fb0df89007f9dd89f381a133b561f2107d49e129c717d7f',
    adapt(text) {
      return replace(text, '} else if (ready && Date.now() - lastAsk >= ASK_AGAIN_MS) {',
        "} else if (!process.env.GHOST_CODEX_BRIDGE_MODULE && ready && Date.now() - lastAsk >= ASK_AGAIN_MS) {");
    },
  },
];

const planned = [];
for (const change of changes) {
  const file = join(change.root === 'app' ? appRoot : petRoot, change.path);
  const backup = join(backups, change.path.replaceAll('/', '_'));
  const current = await readFile(file);
  let original;
  try { original = await readFile(backup); }
  catch (error) { if (error.code !== 'ENOENT') throw error; original = current; }
  if (sha(original) !== change.hash) throw new Error(`Unsupported upstream file: ${change.path}. No files were changed.`);
  const patched = change.adapt(original.toString('utf8'));
  if (sha(current) !== change.hash && !current.equals(Buffer.from(patched))
    && sha(current) !== earlierAdapter[change.path] && sha(current) !== installed[change.path]) {
    throw new Error(`Unknown local edits in ${change.path}. Preserve and inspect them before installing.`);
  }
  planned.push({ file, backup, original, current, patched, needsWrite: !current.equals(Buffer.from(patched)) });
}
const viewFile = join(petRoot, 'web/codex-view.js');
const viewBytes = await readFile(join(project, 'integration/codex-view.js'));
let oldView = null;
try { oldView = await readFile(viewFile); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (oldView && !oldView.equals(viewBytes) && sha(oldView) !== installed['web/codex-view.js']
  && sha(oldView) !== '1387a613c63fdfc5e30bd7a8a88a8f339fb50ea539db926bc5922f59b7c1072e') {
  throw new Error('Unknown local edits in web/codex-view.js. No files were changed.');
}
await mkdir(backups, { recursive: true });
for (const item of planned) {
  try { await writeFile(item.backup, item.original, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
const writes = planned.filter((item) => item.needsWrite)
  .map((item) => ({ file: item.file, before: item.current, after: Buffer.from(item.patched) }));
if (!oldView?.equals(viewBytes)) writes.unshift({ file: viewFile, before: oldView, after: viewBytes });
// Stage everything and check existing destinations before touching a working runtime.
const replaced = [];
try {
  for (const item of writes) {
    if (item.before) { const handle = await open(item.file, 'r+'); await handle.close(); }
    await writeFile(`${item.file}.ghost-pending`, item.after);
  }
  for (const item of writes) {
    await rename(`${item.file}.ghost-pending`, item.file);
    replaced.push(item);
  }
  const hashes = Object.fromEntries(planned.map((item, index) => [changes[index].path, sha(Buffer.from(item.patched))]));
  hashes['web/codex-view.js'] = sha(viewBytes);
  await writeFile(`${manifestFile}.pending`, JSON.stringify(hashes, null, 2));
  await rename(`${manifestFile}.pending`, manifestFile);
} catch (error) {
  const rollbackErrors = [];
  for (const item of replaced.reverse()) {
    try {
      if (item.before) await writeFile(item.file, item.before);
      else await unlink(item.file);
    } catch { rollbackErrors.push(item.file); }
  }
  if (rollbackErrors.length) throw new Error(`Adapter write failed; restore these files from ${backups}: ${rollbackErrors.join(', ')}`, { cause: error });
  throw new Error('Adapter installation failed; runtime changes were rolled back.', { cause: error });
} finally {
  for (const item of writes) await unlink(`${item.file}.ghost-pending`).catch(() => {});
}
console.log(JSON.stringify({ adapter: 'ghost-codex-bridge', upstream: '0.2.19',
  patched: planned.filter((p) => p.needsWrite).length, originalsPreserved: true }));
