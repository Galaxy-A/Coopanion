import { readdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

export const MICROPHONE_PLUGIN = fileURLToPath(new URL('../native/heybox-microphone.dll', import.meta.url));
const PIPE_ROOT = '\\\\.\\pipe\\';
const TOKEN = /^[a-f0-9]{32}$/;
const MAGIC = 0x314d4248;
const MAX_BYTES = 32 * 1024 * 1024;
interface PcmAudio { pcm: Buffer; sampleRate: number; channels: number }
interface PipeMessage { type: 'active' | 'inactive' | 'accepted' | 'started' | 'completed' | 'stopped' | 'invalid' }

function reason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Microphone speech cancelled.');
}

function header(audio?: PcmAudio): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32LE(MAGIC, 0);
  bytes.writeUInt32LE(audio ? 1 : 0, 4);
  if (audio) {
    bytes.writeUInt32LE(audio.sampleRate, 8);
    bytes.writeUInt32LE(audio.channels, 12);
    bytes.writeUInt32LE(audio.pcm.length, 16);
  }
  return bytes;
}

/** Each connection has one command. The plugin acknowledges consumption or cancellation. */
function exchange(path: string, signal?: AbortSignal, audio?: PcmAudio): Promise<boolean> {
  if (signal?.aborted) return Promise.reject(reason(signal));
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let done = false, started = false, accepted = false, output = '';
    let abortError: Error | undefined;
    let cancelTimer: NodeJS.Timeout | undefined;
    const durationMs = audio ? audio.pcm.length / (audio.sampleRate * audio.channels * 2) * 1000 : 0;
    const timer = setTimeout(() => finish(new Error('Microphone plugin did not finish its request.')), audio ? durationMs + 10_000 : 2500);
    function finish(error?: Error, active = false): void {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(cancelTimer);
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      if (error) reject(error); else resolve(active);
    }
    function abort(): void {
      if (!signal || done) return;
      abortError = reason(signal);
      if (started) {
        socket.write(Buffer.from([1]));
        cancelTimer = setTimeout(() => finish(abortError), 1000);
      } else finish(abortError);
    }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    socket.on('connect', () => { if (!done) socket.write(header(audio)); });
    socket.on('error', error => finish(abortError ?? error));
    socket.on('close', () => { if (!done) finish(abortError ?? new Error('Microphone plugin disconnected before completing its request.')); });
    socket.setEncoding('utf8');
    socket.on('data', part => {
      output += part;
      if (output.length > 8192) { finish(new Error('Microphone plugin response exceeded its limit.')); return; }
      let newline: number;
      while ((newline = output.indexOf('\n')) >= 0 && !done) {
        const line = output.slice(0, newline); output = output.slice(newline + 1);
        let message: PipeMessage;
        try { message = JSON.parse(line) as PipeMessage; }
        catch { finish(new Error('Microphone plugin returned invalid JSON.')); return; }
        if (!message || typeof message !== 'object') { finish(new Error('Microphone plugin returned an invalid response.')); return; }
        if (message.type === 'active' && !audio) finish(undefined, true);
        else if (message.type === 'inactive') audio ? finish(new Error('The microphone effect has no active capture stream. Open HeyBox voice and enable this microphone.')) : finish();
        else if (message.type === 'accepted' && audio && !accepted) { accepted = true; socket.write(audio.pcm); }
        else if (message.type === 'started' && audio && accepted && !started) { started = true; if (signal?.aborted) abort(); }
        else if (message.type === 'completed' && started) finish(abortError, true);
        else if (message.type === 'stopped' && started) finish(abortError ?? new Error('Microphone capture stopped before speech completed.'));
        else finish(new Error('Microphone plugin returned an unexpected response.'));
      }
    });
  });
}

async function instances(token: string): Promise<string[]> {
  if (process.platform !== 'win32') throw new Error('Microphone injection requires Windows.');
  if (!TOKEN.test(token)) throw new Error('Configure the microphone effect first.');
  const prefix = `GhostCompanion.Heybox.${token}.`;
  const names = (await readdir(PIPE_ROOT)).filter(name => name.startsWith(prefix) && /^\d+\.\d+\.status$/.test(name.slice(prefix.length))).sort();
  if (names.length > 16) throw new Error('Too many microphone effect instances are active. Close unused capture applications.');
  return names.map(name => `${PIPE_ROOT}${name}`);
}

async function activeInstances(token: string, signal?: AbortSignal) {
  const names = await instances(token);
  const results = await Promise.all(names.map(async name => {
    try {
      for (let attempt = 0; ; attempt++) {
        try { return { name, active: await exchange(name, signal), error: '' }; }
        catch (error) {
          if (attempt >= 2 || (error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
          await wait(100, undefined, { signal });
        }
      }
    }
    catch (error) {
      if (signal?.aborted) throw reason(signal);
      return { name, active: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  return { names: results.filter(result => result.active).map(result => result.name),
    detail: results.find(result => result.error)?.error ?? (names.length ? 'Microphone effect is loaded; waiting for a capture stream.' : 'Microphone effect is not loaded. Configure Equalizer APO for this microphone and reopen HeyBox voice.') };
}

export async function microphoneStatus(token: string, signal?: AbortSignal): Promise<{ ready: boolean; active: number; detail: string }> {
  try {
    const result = await activeInstances(token, signal);
    return { ready: result.names.length > 0, active: result.names.length, detail: result.names.length ? '' : result.detail };
  } catch (error) {
    if (signal?.aborted) throw reason(signal);
    return { ready: false, active: 0, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Broadcasts to every active graph for the selected microphone; it cannot target one app. */
export async function injectMicrophone(audio: PcmAudio, token: string, signal: AbortSignal): Promise<void> {
  if (!Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 192000
    || (audio.channels !== 1 && audio.channels !== 2) || !Buffer.isBuffer(audio.pcm)
    || !audio.pcm.length || audio.pcm.length > MAX_BYTES || audio.pcm.length % (audio.channels * 2)) {
    throw new Error('Microphone speech must be aligned PCM16, one or two channels, 8000–192000 Hz, at most 32 MiB.');
  }
  signal.throwIfAborted();
  const active = await activeInstances(token, signal);
  if (!active.names.length) throw new Error(active.detail);
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  let failure: unknown;
  const results = await Promise.allSettled(active.names.map(async name => {
    try { await exchange(name.replace(/\.status$/, '.audio'), combined, audio); }
    catch (error) { failure ??= error; controller.abort(error); throw error; }
  }));
  if (failure) throw failure;
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}
