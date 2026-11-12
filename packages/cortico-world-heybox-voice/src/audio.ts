import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AudioDevice {
  id: number;
  name: string;
  direction: 'input' | 'output';
}

const HELPER = fileURLToPath(new URL('../native/audio.ps1', import.meta.url));
const MAX_PCM_BYTES = 32 * 1024 * 1024;
const START_TIMEOUT_MS = 30_000;
const CANCEL_GRACE_MS = 1500;

function frame(value: object): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length);
  return Buffer.concat([length, body]);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Audio operation cancelled.');
}

/** Each helper owns one device handle; a resolved request has also reaped its process. */
function invoke(request: object, signal: AbortSignal | undefined, pcm?: Buffer, durationMs = 0): Promise<unknown> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Audio device playback requires Windows.'));
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const command = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let error: Error | null = null;
    let result: unknown;
    let completed = false;
    let ready = false;
    let output = '';
    let stderr = '';
    let killTimer: NodeJS.Timeout | undefined;
    let operationTimer: NodeJS.Timeout | undefined;
    const stop = (reason: Error): void => {
      if (error) return;
      error = reason;
      // EOF also cancels helpers blocked while receiving a partial PCM payload.
      child.stdin.destroy();
      killTimer = setTimeout(() => { child.kill(); }, CANCEL_GRACE_MS);
    };
    const onAbort = (): void => { if (signal) stop(abortReason(signal)); };
    const startupTimer = setTimeout(() => stop(new Error('Audio helper startup timed out.')), START_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdin.on('error', (err) => { if (!completed && !error) stop(new Error(`Audio input failed: ${err.message}`)); });
    child.stderr.on('data', (part: Buffer) => { stderr = (stderr + part.toString('utf8')).slice(-8192); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (part: string) => {
      output += part;
      if (output.length > 65536) { stop(new Error('Audio helper response exceeded its limit.')); return; }
      let newline: number;
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline).trim();
        output = output.slice(newline + 1);
        if (!line || error) continue;
        let value: unknown;
        try { value = JSON.parse(line); }
        catch { stop(new Error('Audio helper returned invalid JSON.')); return; }
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          stop(new Error('Audio helper returned an invalid message.'));
          return;
        }
        const message = value as Record<string, unknown>;
        if (message.type === 'ready' && !ready) {
          ready = true;
          clearTimeout(startupTimer);
          operationTimer = setTimeout(() => stop(new Error('Audio helper did not open the requested device.')), 20_000);
          child.stdin.write(frame(request));
          if (pcm) child.stdin.write(pcm);
        } else if (message.type === 'devices' || message.type === 'completed') {
          completed = true;
          result = message.type === 'devices' ? message.devices : undefined;
          clearTimeout(operationTimer);
          child.stdin.end();
          operationTimer = setTimeout(() => stop(new Error('Audio helper did not exit after completion.')), CANCEL_GRACE_MS);
        } else if (message.type === 'opened' && ready && !completed) {
          clearTimeout(operationTimer);
          operationTimer = setTimeout(() => stop(new Error('Audio device did not complete playback.')), Math.ceil(durationMs) + 15_000);
        } else {
          stop(new Error('Audio helper returned an unexpected message.'));
          return;
        }
      }
    });
    child.on('error', (err) => { stop(new Error(`Audio helper could not start: ${err.message}`)); });
    child.on('close', (code) => {
      clearTimeout(startupTimer);
      clearTimeout(operationTimer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else if (code !== 0 || !completed) reject(new Error(`Audio helper failed${code === null ? '' : ` (${code})`}${stderr.trim() ? `: ${stderr.trim()}` : '.'}`));
      else resolve(result);
    });
  });
}

/** Names are WinMM device names, which Windows may truncate to 31 UTF-16 code units. */
export async function listAudioDevices(signal?: AbortSignal): Promise<AudioDevice[]> {
  const result = await invoke({ operation: 'list' }, signal);
  if (!Array.isArray(result) || result.some((device) => typeof device !== 'object' || device === null
    || !Number.isInteger(device.id) || device.id < 0 || typeof device.name !== 'string'
    || (device.direction !== 'input' && device.direction !== 'output'))) {
    throw new Error('Audio helper returned invalid devices.');
  }
  return result as AudioDevice[];
}

/** Plays PCM16 to one exact, unique output name; unavailable or ambiguous names fail. */
export async function playPcm(audio: { pcm: Buffer; sampleRate: number; channels: number }, deviceName: string, signal: AbortSignal): Promise<void> {
  if (typeof deviceName !== 'string' || !deviceName.trim()) throw new Error('An exact output device name is required.');
  if (!Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 192000
    || (audio.channels !== 1 && audio.channels !== 2) || !Buffer.isBuffer(audio.pcm)
    || audio.pcm.length === 0 || audio.pcm.length > MAX_PCM_BYTES || audio.pcm.length % (audio.channels * 2) !== 0) {
    throw new Error('Audio must be aligned PCM16, one or two channels, 8000-192000 Hz, at most 32 MiB.');
  }
  await invoke({ operation: 'play', deviceName, sampleRate: audio.sampleRate, channels: audio.channels,
    bitsPerSample: 16, pcmBytes: audio.pcm.length }, signal, audio.pcm,
  audio.pcm.length / (audio.sampleRate * audio.channels * 2) * 1000);
}
