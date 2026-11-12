import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { get as httpsGet } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';

const HELPER = fileURLToPath(new URL('../native/microphone-setup.ps1', import.meta.url));
const PLUGIN = fileURLToPath(new URL('../native/heybox-microphone.dll', import.meta.url));
const PS = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const INSTALLER_NAME = 'EqualizerAPO-x64-1.4.2.exe';
const INSTALLER_URL = `https://sourceforge.net/projects/equalizerapo/files/1.4.2/${INSTALLER_NAME}/download`;
// SourceForge's official 1.4.2 file metadata supplies the installer digest.
const INSTALLER_SHA256 = '7403be7427bbe1936a40dded082829b6e217fc4f5990fee5cba501f0ae055afa';
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

interface DownloadResult { host: string; bytes: number; digest: string }

function downloadInstaller(url: string, destination: string, signal?: AbortSignal, redirects = 0): Promise<DownloadResult> {
  if (redirects > 8) return Promise.reject(new Error('Equalizer APO download followed too many redirects.'));
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, { headers: { 'User-Agent': 'GhostCompanion HeyBox voice bridge' } }, (response: IncomingMessage) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        downloadInstaller(new URL(location, url).toString(), destination, signal, redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Equalizer APO download failed (${status}).`));
        return;
      }
      const digest = createHash('sha256');
      let bytes = 0;
      const sink = new Transform({
        transform(chunk: Buffer, _, callback) {
          bytes += chunk.length;
          if (bytes > 32 * 1024 * 1024) { callback(new Error('Equalizer APO installer exceeds 32 MiB.')); return; }
          digest.update(chunk); callback(null, chunk);
        },
      });
      const output = createWriteStream(destination);
      const fail = (error: unknown) => { response.destroy(); output.destroy(); reject(error); };
      response.once('error', fail); sink.once('error', fail); output.once('error', fail);
      output.once('finish', () => resolve({ host: new URL(url).host, bytes, digest: digest.digest('hex') }));
      response.pipe(sink).pipe(output);
    });
    request.once('error', reject);
    request.setTimeout(600000, () => request.destroy(new Error('Equalizer APO download timed out.')));
    if (signal) {
      const abort = () => request.destroy(signal.reason instanceof Error ? signal.reason : new Error('Equalizer APO download aborted.'));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    }
  });
}

export interface MicrophoneDevice { id: string; name: string; isDefault: boolean }
interface Inspection {
  installed: boolean;
  installDir: string;
  configDir: string;
  configuredEndpoint: string;
  pluginInstalled: boolean;
  devices: MicrophoneDevice[];
  boot: string;
  ownerSid: string;
  routeToken: string;
}
interface Evidence { version: 1; token: string; installBoot?: string }

function invoke(mode: string, token: string, values: Record<string, string> = {}, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER, '-Mode', mode, '-Token', token];
    for (const [key, value] of Object.entries(values)) args.push(`-${key}`, value);
    const child = spawn(PS, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let out = '', err = '';
    child.stdout.on('data', (bytes: Buffer) => { out += bytes.toString('utf8'); if (out.length > 131072) child.kill(); });
    child.stderr.on('data', (bytes: Buffer) => { err = (err + bytes.toString('utf8')).slice(-8192); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(out.trim().replace(/^\uFEFF/, '')) : reject(new Error(err.trim() || `Microphone setup helper exited (${code}).`)));
  });
}

/** Configuration evidence does not assert that the microphone's audio processing is active. */
export class MicrophoneSetup {
  private evidence: Evidence = { version: 1, token: randomBytes(16).toString('hex') };
  private inspection: Inspection = { installed: false, installDir: '', configDir: '', configuredEndpoint: '', pluginInstalled: false, devices: [], boot: '', ownerSid: '', routeToken: '' };
  private phase = 'idle';
  private error = '';
  private job: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private identityReady = false;
  private identityError = '';
  readonly installerDir: string;

  constructor(private readonly dataDir: string) { this.installerDir = join(dataDir, 'heybox', 'installers', 'equalizer-apo'); }
  get token(): string { return this.identityReady ? this.inspection.routeToken : ''; }
  private get file(): string { return join(this.dataDir, 'heybox', 'microphone.json'); }

  async load(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.identityReady = false;
    this.identityError = '';
    this.inspection = { ...this.inspection, configuredEndpoint: '', pluginInstalled: false, routeToken: '' };
    try {
      try {
        const value = JSON.parse(await readFile(this.file, 'utf8')) as Evidence;
        if (value?.version !== 1 || typeof value.token !== 'string' || !/^[0-9a-f]{32}$/.test(value.token)) throw new Error('Saved microphone bridge identity is invalid. Restore microphone.json before configuring microphone delivery.');
        this.evidence = value;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        signal?.throwIfAborted();
        await this.save();
      }
      signal?.throwIfAborted();
      this.identityReady = true;
    } catch (error) {
      if (signal?.aborted) throw error;
      this.identityError = `Microphone bridge identity could not be loaded: ${message(error)}`;
      this.error = this.identityError;
      this.phase = 'error';
      return;
    }
    await this.refresh(signal);
  }

  async refresh(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (!this.identityReady) { this.error = this.identityError || 'Microphone bridge identity has not been saved.'; this.phase = 'error'; return; }
    try {
      const value = JSON.parse(await invoke('inspect', this.evidence.token, {}, signal)) as Inspection;
      if (typeof value.installed !== 'boolean' || typeof value.pluginInstalled !== 'boolean'
        || ['installDir', 'configDir', 'configuredEndpoint', 'boot', 'ownerSid', 'routeToken'].some((key) => typeof value[key as keyof Inspection] !== 'string')
        || (value.pluginInstalled && !/^[0-9a-f]{32}$/.test(value.routeToken)) || !Array.isArray(value.devices)
        || value.devices.some((device) => typeof device.id !== 'string' || typeof device.name !== 'string' || typeof device.isDefault !== 'boolean')) {
        throw new Error('Microphone setup returned invalid device information.');
      }
      this.inspection = value;
      if (this.evidence.installBoot && this.evidence.installBoot !== value.boot) {
        delete this.evidence.installBoot;
        await this.save();
      }
      if (!this.job) { this.error = ''; this.phase = 'idle'; }
    } catch (error) {
      this.inspection = { ...this.inspection, installed: false, installDir: '', configuredEndpoint: '', pluginInstalled: false, routeToken: '', devices: [] };
      if (signal?.aborted) throw error;
      this.error = message(error);
    }
  }

  state() {
    return { phase: this.phase, busy: !!this.job, error: this.error, installed: this.inspection.installed,
      installDir: this.inspection.installDir, configDir: this.inspection.configDir, configuredEndpoint: this.inspection.configuredEndpoint,
      pluginInstalled: this.inspection.pluginInstalled, devices: this.inspection.devices,
      restartRequired: !!this.evidence.installBoot && this.evidence.installBoot === this.inspection.boot,
      installerDir: this.installerDir };
  }

  install(): void {
    if (this.job) return;
    if (!this.identityReady) { this.error = this.identityError || 'Microphone bridge identity has not been saved.'; this.phase = 'error'; return; }
    this.error = '';
    this.job = this.doInstall().catch((error: unknown) => {
      this.phase = 'error'; this.error = message(error);
    }).finally(() => { this.job = null; });
  }

  async configure(endpointId: string): Promise<void> {
    this.requireIdentity();
    return this.exclusive(async () => {
      await this.refresh();
      if (!this.inspection.installed) throw new Error(this.error || 'Install Equalizer APO first.');
      if (!this.inspection.devices.some((device) => device.id === endpointId)) throw new Error('The selected active capture endpoint was not found.');
      this.error = ''; this.phase = 'configuring';
      this.inspection = { ...this.inspection, pluginInstalled: false, routeToken: '' };
      try {
        await invoke('configure', this.evidence.token, { EndpointId: endpointId, PluginPath: PLUGIN, RouteToken: randomBytes(16).toString('hex') });
        await this.refresh();
        if (!this.inspection.pluginInstalled || this.inspection.configuredEndpoint !== endpointId) throw new Error(this.error || 'The microphone configuration was not installed.');
      } catch (error) { this.inspection = { ...this.inspection, pluginInstalled: false, routeToken: '' }; this.error = message(error); this.phase = 'error'; throw error; }
    });
  }

  async openConfigurator(): Promise<void> {
    this.requireIdentity();
    return this.exclusive(async () => {
      try { await invoke('configurator', this.evidence.token); }
      catch (error) { this.error = message(error); throw error; }
    });
  }

  async remove(): Promise<void> {
    this.requireIdentity();
    return this.exclusive(async () => {
      this.error = ''; this.phase = 'configuring';
      this.inspection = { ...this.inspection, pluginInstalled: false, routeToken: '' };
      try { await invoke('remove', this.evidence.token); await this.refresh(); }
      catch (error) { this.inspection = { ...this.inspection, pluginInstalled: false, routeToken: '' }; this.error = message(error); this.phase = 'error'; throw error; }
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.job) return Promise.reject(new Error('Wait for microphone component operation to finish.'));
    const running = operation();
    this.job = running.then(() => undefined, () => undefined).finally(() => { if (this.job === tracked) this.job = null; });
    const tracked = this.job;
    return running;
  }

  private async doInstall(): Promise<void> {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('The bundled microphone plugin requires Windows x64.');
    this.phase = 'downloading';
    await mkdir(this.installerDir, { recursive: true });
    const installer = join(this.installerDir, INSTALLER_NAME);
    const partial = `${installer}.partial`;
    const timeout = AbortSignal.timeout(600000);
    try {
      const result = await downloadInstaller(INSTALLER_URL, partial, timeout);
      if (result.digest !== INSTALLER_SHA256) throw new Error('The Equalizer APO installer did not match the official SHA-256.');
      await rename(partial, installer);
    } catch (error) {
      throw new Error(`Equalizer APO download stopped before completion: ${message(error)}`);
    } finally { await unlink(partial).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
    this.phase = 'installing';
    await invoke('install', this.evidence.token, { InstallerPath: installer });
    await this.refresh();
    if (!this.inspection.installed) {
      delete this.evidence.installBoot;
      await this.save();
      throw new Error(this.error || 'Equalizer APO installation was not detected. Complete the installer before configuring microphone delivery.');
    }
    if (this.inspection.boot) { this.evidence.installBoot = this.inspection.boot; await this.save(); }
    this.phase = this.evidence.installBoot ? 'restart' : 'idle';
  }

  private requireIdentity(): void {
    if (!this.identityReady) throw new Error(this.identityError || 'Microphone bridge identity has not been saved.');
  }

  private save(): Promise<void> {
    const value = JSON.stringify(this.evidence, null, 2) + '\n';
    this.saving = this.saving.catch(() => {}).then(async () => {
      await mkdir(join(this.dataDir, 'heybox'), { recursive: true });
      await writeFile(`${this.file}.partial`, value, { mode: 0o600 });
      await rename(`${this.file}.partial`, this.file);
    });
    return this.saving;
  }

  async close(): Promise<void> { await this.job; await this.saving.catch(() => {}); }
}
