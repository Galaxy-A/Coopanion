import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HeyboxProcess {
  pid: number;
  parentPid: number;
  name: string;
  startedAt: string | null;
}

export interface CaptureStatus {
  pid: number;
  phase: 'running' | 'stopping' | 'stopped' | 'error';
  startedAt: string;
  lastPcmAt: string | null;
  chunks: number;
  pcmBytes: number;
  peak: number;
  rms: number;
  silentChunks: number;
  discontinuities: number;
  reason?: string;
}

export interface ProcessCapture {
  pid: number;
  sampleRate: 16000;
  channels: 1;
  /** Settles after the helper exits. Explicit stop and abort finish normally. */
  done: Promise<void>;
  stop(): Promise<void>;
  getStatus(): CaptureStatus;
}

const HELPER = fileURLToPath(new URL('../native/capture.ps1', import.meta.url));
const STOP_GRACE_MS = 1500;

function cancelled(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Process audio capture cancelled.');
}

function startHelper(operation: 'List' | 'Capture', pid?: number): ChildProcessWithoutNullStreams {
  if (process.platform !== 'win32') throw new Error('Process audio capture requires Windows.');
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return spawn(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', HELPER,
      '-Operation', operation, ...(pid === undefined ? [] : ['-TargetProcessId', String(pid)])],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}

function readMessages(child: ChildProcessWithoutNullStreams, onMessage: (message: Record<string, unknown>) => void,
  fail: (error: Error) => void): void {
  let pending = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (part: string) => {
    pending += part;
    let newline: number;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (!line) continue;
      try {
        const message: unknown = JSON.parse(line);
        if (typeof message !== 'object' || message === null || Array.isArray(message)) throw new Error('Invalid capture helper message.');
        onMessage(message as Record<string, unknown>);
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    }
    if (pending.length > 16384) fail(new Error('Capture helper response exceeded its limit.'));
  });
}

/** Returns HeyboxChat.exe roots; child audio processes are included by Windows process loopback. */
export async function listHeyboxProcesses(signal?: AbortSignal): Promise<HeyboxProcess[]> {
  if (signal?.aborted) throw cancelled(signal);
  const child = startHelper('List');
  return new Promise((resolve, reject) => {
    let result: HeyboxProcess[] | undefined;
    let error: Error | undefined;
    let stderr = '';
    let killTimer: NodeJS.Timeout | undefined;
    const fail = (reason: Error): void => {
      if (error) return;
      error = reason;
      child.stdin.destroy();
      killTimer = setTimeout(() => { child.kill(); }, STOP_GRACE_MS);
    };
    const onAbort = (): void => { if (signal) fail(cancelled(signal)); };
    const deadline = setTimeout(() => fail(new Error('Heybox process enumeration timed out.')), 30000);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdin.on('error', (reason) => fail(reason));
    child.on('error', fail);
    child.stderr.on('data', (part: Buffer) => { stderr = (stderr + part.toString('utf8')).slice(-8192); });
    readMessages(child, (message) => {
      if (error) return;
      if (message.type !== 'processes' || result || !Array.isArray(message.processes)
        || message.processes.some((value: unknown) => {
          if (typeof value !== 'object' || value === null) return true;
          const item = value as Record<string, unknown>;
          return !Number.isInteger(item.pid) || (item.pid as number) <= 0 || !Number.isInteger(item.parentPid)
            || (item.parentPid as number) < 0 || typeof item.name !== 'string' || item.name.toLowerCase() !== 'heyboxchat.exe'
            || (item.startedAt !== null && typeof item.startedAt !== 'string');
        })) throw new Error('Capture helper returned invalid Heybox processes.');
      result = message.processes as HeyboxProcess[];
      child.stdin.end();
    }, fail);
    child.on('close', (code) => {
      clearTimeout(deadline);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else if (code !== 0 || !result) reject(new Error(`Heybox process enumeration failed: ${stderr.trim() || `exit ${code}`}`));
      else resolve(result);
    });
  });
}

/** Captures only the supplied process tree as 20 ms PCM16 little-endian blocks, without recording files. */
export async function startProcessCapture(pid: number, onPcm: (pcm: Buffer) => void, signal: AbortSignal): Promise<ProcessCapture> {
  if (!Number.isInteger(pid) || pid <= 0 || pid > 0x7fffffff) throw new Error('A positive target process ID is required.');
  if (signal.aborted) throw cancelled(signal);
  const child = startHelper('Capture', pid);
  let error: Error | undefined;
  let stderr = '';
  let started = false;
  let stopped = false;
  let stopping = false;
  let exited = false;
  let killTimer: NodeJS.Timeout | undefined;
  let watchdog: NodeJS.Timeout | undefined;
  let resolveReady: (capture: ProcessCapture) => void;
  let rejectReady: (error: Error) => void;
  let resolveDone: () => void;
  let rejectDone: (error: Error) => void;
  const ready = new Promise<ProcessCapture>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // Startup failures belong to ready; runtime failures remain observable through done.
  void done.catch(() => {});
  const status: CaptureStatus = { pid, phase: 'running', startedAt: '', lastPcmAt: null,
    chunks: 0, pcmBytes: 0, peak: 0, rms: 0, silentChunks: 0, discontinuities: 0 };
  const stop = (): void => {
    if (stopping || exited) return;
    stopping = true;
    status.phase = 'stopping';
    clearTimeout(watchdog);
    child.stdin.destroy();
    killTimer = setTimeout(() => {
      error ||= new Error('Process capture helper did not stop gracefully.');
      child.kill();
    }, STOP_GRACE_MS);
  };
  const fail = (reason: Error): void => { if (!error) { error = reason; stop(); } };
  const onAbort = (): void => { if (!started) error ||= cancelled(signal); stop(); };
  const resetWatchdog = (durationMs: number): void => {
    clearTimeout(watchdog);
    if (!stopping) watchdog = setTimeout(() => fail(new Error('Process capture helper stopped responding.')), durationMs);
  };
  const capture: ProcessCapture = { pid, sampleRate: 16000, channels: 1, done,
    stop: async () => { stop(); await done; }, getStatus: () => ({ ...status }) };
  resetWatchdog(30000);
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  child.stdin.on('error', (reason) => { if (!stopping) fail(reason); });
  child.on('error', fail);
  child.stderr.on('data', (part: Buffer) => { stderr = (stderr + part.toString('utf8')).slice(-8192); });
  readMessages(child, (message) => {
    if (error || stopping) return;
    resetWatchdog(10000);
    if (message.type === 'started' && !started && message.pid === pid && message.sampleRate === 16000
      && message.channels === 1 && message.bitsPerSample === 16 && message.mode === 'include-target-process-tree') {
      started = true;
      status.startedAt = new Date().toISOString();
      resolveReady(capture);
    } else if (message.type === 'pcm' && started && !stopped && message.sequence === status.chunks
      && typeof message.pcm === 'string' && /^[A-Za-z0-9+/]{854}==$/.test(message.pcm)
      && Number.isInteger(message.discontinuities) && (message.discontinuities as number) >= status.discontinuities) {
      const pcm = Buffer.from(message.pcm, 'base64');
      if (pcm.length !== 640) throw new Error('Capture helper returned an invalid PCM block.');
      let peak = 0, sum = 0;
      for (let at = 0; at < pcm.length; at += 2) {
        const sample = pcm.readInt16LE(at) / 32768;
        peak = Math.max(peak, Math.abs(sample));
        sum += sample * sample;
      }
      status.chunks++;
      status.pcmBytes += pcm.length;
      status.peak = peak;
      status.rms = Math.sqrt(sum / 320);
      status.silentChunks += peak === 0 ? 1 : 0;
      status.discontinuities = message.discontinuities as number;
      status.lastPcmAt = new Date().toISOString();
      onPcm(pcm);
    } else if (message.type === 'status' && started && !stopped && Number.isInteger(message.discontinuities)
      && (message.discontinuities as number) >= status.discontinuities) {
      status.discontinuities = message.discontinuities as number;
    } else if (message.type === 'stopped' && started && !stopped && typeof message.reason === 'string') {
      stopped = true;
      status.reason = message.reason;
      child.stdin.end();
      resetWatchdog(STOP_GRACE_MS);
    } else throw new Error('Capture helper returned an unexpected message.');
  }, fail);
  child.on('close', (code) => {
    exited = true;
    clearTimeout(watchdog);
    clearTimeout(killTimer);
    signal.removeEventListener('abort', onAbort);
    if (!error && (code !== 0 || (!stopped && !stopping))) {
      error = new Error(`Process audio capture failed: ${stderr.trim() || `exit ${code}`}`);
    }
    status.phase = error ? 'error' : 'stopped';
    if (error) { status.reason = error.message; rejectDone(error); }
    else { status.reason ||= 'stopped'; resolveDone(); }
    if (!started) rejectReady(error || new Error('Process capture stopped before startup.'));
  });
  return ready;
}
