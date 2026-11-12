import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { deploymentRoot } from 'cortico/paths.ts';
import type { AudioDevice } from './audio.ts';

const HELPER = fileURLToPath(new URL('../native/setup.ps1', import.meta.url));
const DRIVER_URL = 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack46.zip';
const ps = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
function run(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let out = '', err = '';
    child.stdout.on('data', (bytes: Buffer) => { out = (out + bytes.toString('utf8')).slice(-65536); });
    child.stderr.on('data', (bytes: Buffer) => { err = (err + bytes.toString('utf8')).slice(-8192); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(out.trim().replace(/^\uFEFF/, '')) : reject(new Error(err || `Setup helper exited (${code}).`)));
  });
}
interface Evidence {
  version: 1;
  installBoot?: string;
  installPhase?: 'installing' | 'restart';
  sendProbeAt?: string;
  sendConfirmedAt?: string;
  receiveAt?: string;
  route?: string;
}

/** Durable first-use evidence is separate from editable configuration. */
export class Setup {
  private evidence: Evidence = { version: 1 };
  private saving: Promise<void> = Promise.resolve();
  private job: Promise<void> | null = null;
  private phase = 'idle';
  private error = '';
  private system = { build: 0, boot: '' };
  readonly driverDir = join(deploymentRoot(), 'drivers', 'vb-cable');
  constructor(private readonly dataDir: string) {}
  private get file() { return join(this.dataDir, 'heybox', 'setup.json'); }
  async load(signal?: AbortSignal): Promise<void> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as Evidence;
      if (value.version === 1) this.evidence = value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.system = JSON.parse(await run(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER, '-Mode', 'inspect'], signal));
    if (this.evidence.installBoot && this.evidence.installBoot !== this.system.boot) {
      delete this.evidence.installBoot;
      delete this.evidence.installPhase;
      await this.save();
    }
  }
  state(devices: AudioDevice[], route: string) {
    const outputs = devices.filter((d) => d.direction === 'output' && /^CABLE Input \(/i.test(d.name));
    const inputs = devices.filter((d) => d.direction === 'input' && /^CABLE Output \(/i.test(d.name));
    const sameRoute = route === this.evidence.route;
    return { phase: this.phase, error: this.error, driverDir: this.driverDir,
      build: this.system.build, supported: this.system.build >= 20348,
      driverReady: outputs.length === 1 && inputs.length === 1,
      suggestedOutput: outputs.length === 1 ? outputs[0]!.name : '',
      restartRequired: !!this.evidence.installBoot && this.evidence.installBoot === this.system.boot,
      sendProbeAt: sameRoute ? this.evidence.sendProbeAt ?? '' : '',
      sendConfirmedAt: sameRoute ? this.evidence.sendConfirmedAt ?? '' : '',
      receiveAt: this.evidence.receiveAt ?? '' };
  }
  async played(route: string): Promise<void> {
    if (this.evidence.route !== route) delete this.evidence.sendConfirmedAt;
    this.evidence.route = route;
    this.evidence.sendProbeAt = new Date().toISOString();
    await this.save();
  }
  async confirmSend(route: string): Promise<void> {
    if (this.evidence.route !== route || !this.evidence.sendProbeAt) throw new Error('Play a short phrase on the selected route before confirming reception.');
    this.evidence.sendConfirmedAt = new Date().toISOString();
    await this.save();
  }
  async received(): Promise<void> {
    if (this.evidence.receiveAt) return;
    this.evidence.receiveAt = new Date().toISOString();
    await this.save();
  }
  install(): void {
    if (this.job) return;
    this.job = this.doInstall().catch((error: unknown) => {
      this.phase = 'error';
      this.error = error instanceof Error ? error.message : String(error);
    }).finally(() => { this.job = null; });
  }
  private async doInstall(): Promise<void> {
    if (process.arch !== 'x64') throw new Error('This installer supports Windows x64 only. Install a compatible virtual cable manually.');
    this.error = '';
    this.phase = 'downloading';
    await mkdir(this.driverDir, { recursive: true });
    const archive = join(this.driverDir, 'VBCABLE_Driver_Pack46.zip');
    const response = await fetch(DRIVER_URL, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error(`VB-CABLE download failed (${response.status}).`);
    let size = 0;
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      new Transform({ transform(chunk: Buffer, _, callback) {
        size += chunk.length;
        callback(size > 32 * 1024 * 1024 ? new Error('VB-CABLE archive exceeds 32 MiB.') : null, chunk);
      } }), createWriteStream(`${archive}.partial`));
    await rename(`${archive}.partial`, archive);
    const directory = join(this.driverDir, 'VBCABLE_Driver_Pack46');
    await mkdir(directory, { recursive: true });
    await run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', archive, '-C', directory], AbortSignal.timeout(30000));
    this.phase = 'installing';
    this.evidence.installBoot = this.system.boot;
    this.evidence.installPhase = 'installing';
    await this.save();
    try {
      await run(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER,
        '-Mode', 'install', '-Directory', directory]);
    } catch (error) {
      delete this.evidence.installBoot;
      delete this.evidence.installPhase;
      await this.save();
      throw error;
    }
    this.evidence.installPhase = 'restart';
    await this.save();
    this.phase = 'restart';
  }
  private save(): Promise<void> {
    const json = JSON.stringify(this.evidence, null, 2);
    this.saving = this.saving.catch(() => {}).then(async () => {
      await mkdir(join(this.dataDir, 'heybox'), { recursive: true });
      await writeFile(`${this.file}.pending`, json, { mode: 0o600 });
      await rename(`${this.file}.pending`, this.file);
    });
    return this.saving;
  }
  async close(): Promise<void> { await this.job; await this.saving; }
}
