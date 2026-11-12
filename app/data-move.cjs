/** Data-root moves preserve links and rewrite only owned absolute configuration paths. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function within(value, root) {
  const rel = path.relative(root, value);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
function relocated(value, from, to) {
  return typeof value === 'string' && path.isAbsolute(value) && within(value, from)
    ? path.join(to, path.relative(from, value)) : value;
}
function sameContents(left, right) {
  if (fs.statSync(left).size !== fs.statSync(right).size) return false;
  const a = fs.openSync(left, 'r'), b = fs.openSync(right, 'r');
  const x = Buffer.allocUnsafe(1024 * 1024), y = Buffer.allocUnsafe(x.length);
  try {
    let offset = 0;
    for (;;) {
      const count = fs.readSync(a, x, 0, x.length, offset);
      if (!count) return true;
      if (fs.readSync(b, y, 0, count, offset) !== count || !x.subarray(0, count).equals(y.subarray(0, count))) return false;
      offset += count;
    }
  } finally { fs.closeSync(a); fs.closeSync(b); }
}
function inventory(root, entries = [], rel = '') {
  const file = path.join(root, rel);
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) {
    entries.push({ rel, kind: 'link', target: fs.readlinkSync(file), directory: fs.statSync(file).isDirectory() });
  } else if (stat.isDirectory()) {
    entries.push({ rel, kind: 'directory', atime: stat.atime, mtime: stat.mtime });
    for (const name of fs.readdirSync(file)) inventory(root, entries, path.join(rel, name));
  } else if (stat.isFile()) entries.push({ rel, kind: 'file', atime: stat.atime, mtime: stat.mtime });
  else throw new Error(`Unsupported data entry: ${file}`);
  return entries;
}
function checkInstalledPrograms(from) {
  if (process.platform !== 'win32') return;
  let output;
  try { output = execFileSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\EqualizerAPO'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { if (error.status === 1) return; throw error; }
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:InstallPath|ConfigPath)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/);
    if (match && within(path.resolve(match[1]), from)) {
      throw new Error(`Equalizer APO is installed inside this data directory (${match[1]}). Uninstall Equalizer APO, reinstall it outside the data directory, then configure microphone delivery again before retrying the move.`);
    }
  }
}
function rewriteConfig(file, from, to) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const change = (owner, key) => { if (owner && Object.hasOwn(owner, key)) owner[key] = relocated(owner[key], from, to); };
  change(config.paths, 'memory'); change(config.paths, 'data');
  const speech = config.worlds?.['gpt-sovits'];
  if (speech) {
    change(speech, 'runtimeDir'); change(speech, 'saveDir');
    change(speech.voice, 'audio'); change(speech.weights, 'gpt'); change(speech.weights, 'sovits');
    for (const voice of speech.voices ?? []) {
      change(voice, 'audio'); change(voice.weights, 'gpt'); change(voice.weights, 'sovits');
    }
  }
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
function migrate({ source, destination, commit }) {
  const from = path.resolve(source), to = path.resolve(destination);
  if (within(to, from) || within(from, to)) throw new Error('Data directories must not overlap.');
  if (fs.lstatSync(from).isSymbolicLink()) throw new Error('The data root must be a real directory.');
  if (!fs.existsSync(path.join(from, 'home', 'companion', 'config.json'))) throw new Error('The source deployment config is missing.');
  const configFile = path.join(from, 'home', 'companion', 'config.json');
  if (path.relative(fs.realpathSync(configFile), configFile) !== '') throw new Error('The deployment config must not be reached through a link.');
  let existingParent = path.dirname(to);
  while (!fs.existsSync(existingParent)) existingParent = path.dirname(existingParent);
  const physicalTarget = path.resolve(fs.realpathSync(existingParent), path.relative(existingParent, to));
  if (within(physicalTarget, from) || within(from, physicalTarget)) throw new Error('Data directories must not overlap through links.');
  const destinationExisted = fs.existsSync(to);
  if (destinationExisted && (fs.lstatSync(to).isSymbolicLink() || fs.readdirSync(to).length)) throw new Error('The destination must be an empty real directory.');
  checkInstalledPrograms(from);
  const entries = inventory(from);
  const staging = path.join(path.dirname(to), `.${path.basename(to)}.migrating-${process.pid}-${Date.now()}`);
  let installed = false;
  try {
    fs.mkdirSync(staging, { recursive: true });
    for (const entry of entries) {
      const target = path.join(staging, entry.rel);
      if (entry.kind === 'directory') fs.mkdirSync(target, { recursive: true });
      else if (entry.kind === 'file') {
        fs.copyFileSync(path.join(from, entry.rel), target);
        if (!sameContents(target, path.join(from, entry.rel))) throw new Error(`Data verification failed: ${entry.rel}`);
      } else {
        const originalTarget = path.resolve(path.dirname(path.join(from, entry.rel)), entry.target);
        const link = path.isAbsolute(entry.target) ? relocated(entry.target, from, to)
          : within(originalTarget, from) ? entry.target : originalTarget;
        fs.symlinkSync(link, target, entry.directory ? (path.isAbsolute(link) ? 'junction' : 'dir') : 'file');
        if (path.normalize(fs.readlinkSync(target)) !== path.normalize(link)) throw new Error(`Link verification failed: ${entry.rel}`);
      }
    }
    for (const entry of [...entries].reverse()) {
      if (entry.kind !== 'link') fs.utimesSync(path.join(staging, entry.rel), entry.atime, entry.mtime);
    }
    rewriteConfig(path.join(staging, 'home', 'companion', 'config.json'), from, to);
    if (destinationExisted) fs.rmdirSync(to);
    fs.renameSync(staging, to);
    installed = true;
    for (const entry of entries.filter(entry => entry.kind === 'link')) fs.statSync(path.join(to, entry.rel));
    commit(to);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (installed && !error.preserveDestination) fs.rmSync(to, { recursive: true, force: true });
    if (destinationExisted && !fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
    throw error;
  }
  // Once the pointer is committed, a cleanup failure must leave the verified destination active.
  try { fs.rmSync(from, { recursive: true, force: true }); return { destination: to, cleanupError: '' }; }
  catch (error) { return { destination: to, cleanupError: `Data moved; old-directory cleanup failed (${from}): ${error.message}` }; }
}
module.exports = { migrate };

if (require.main === module) {
  try {
    const [source, destination, pointer] = process.argv.slice(2);
    if (!source || !destination || !pointer) throw new Error('Expected source, destination and pointer paths.');
    const result = migrate({ source, destination, commit(dataDirectory) {
      fs.mkdirSync(path.dirname(pointer), { recursive: true });
      const temp = `${pointer}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(temp, `${JSON.stringify({ version: 1, dataDirectory, updatedAt: new Date().toISOString() }, null, 2)}\n`);
        fs.renameSync(temp, pointer);
      } finally { fs.rmSync(temp, { force: true }); }
    } });
    if (result.cleanupError) console.warn(result.cleanupError);
    console.log(`Data directory: ${result.destination}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
