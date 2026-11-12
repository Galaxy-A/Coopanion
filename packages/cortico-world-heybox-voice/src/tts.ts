import type { HeyboxConfigSection } from './config.ts';

const MAX_WAV_BYTES = 32 * 1024 * 1024;

export interface PcmAudio {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
}

export function validateConfig(cfg: HeyboxConfigSection): URL {
  const url = new URL(cfg.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash) {
    throw new Error('GPT-SoVITS baseUrl must be a loopback HTTP(S) URL without credentials, query or fragment.');
  }
  if (!Number.isFinite(cfg.speed) || cfg.speed < 0.5 || cfg.speed > 2
    || !Number.isInteger(cfg.timeoutMs) || cfg.timeoutMs < 1000 || cfg.timeoutMs > 180000
    || typeof cfg.voice !== 'string' || typeof cfg.outputDevice !== 'string'
    || typeof cfg.receiveViaDesktopPet !== 'boolean') {
    throw new Error('Invalid heybox voice configuration.');
  }
  return url;
}

async function readLimited(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new Error('GPT-SoVITS returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error(`GPT-SoVITS response exceeds ${limit} bytes.`);
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, length);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function requestOptions(token: string, signal: AbortSignal): RequestInit {
  return {
    signal,
    redirect: 'error',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

export async function getHealth(cfg: HeyboxConfigSection, token: string, signal: AbortSignal): Promise<{ ready: boolean; state: string }> {
  const base = validateConfig(cfg);
  const response = await fetch(new URL(`${base.pathname.replace(/\/$/, '')}/health`, base), {
    ...requestOptions(token, AbortSignal.any([signal, AbortSignal.timeout(Math.min(5000, cfg.timeoutMs))])),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`GPT-SoVITS health HTTP ${response.status}.`); }
  const value: unknown = JSON.parse((await readLimited(response, 8192)).toString('utf8'));
  if (!value || typeof value !== 'object' || !('ready' in value) || typeof value.ready !== 'boolean') {
    throw new Error('GPT-SoVITS health response has no boolean ready field.');
  }
  return { ready: value.ready, state: 'state' in value && typeof value.state === 'string' ? value.state : '' };
}

export async function synthesize(text: string, cfg: HeyboxConfigSection, token: string, signal: AbortSignal): Promise<PcmAudio> {
  const base = validateConfig(cfg);
  const response = await fetch(new URL(`${base.pathname.replace(/\/$/, '')}/tts`, base), {
    ...requestOptions(token, AbortSignal.any([signal, AbortSignal.timeout(cfg.timeoutMs)])),
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ text, speed: cfg.speed, ...(cfg.voice.trim() ? { voice: cfg.voice.trim() } : {}) }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`GPT-SoVITS synthesis HTTP ${response.status}.`); }
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!['audio/wav', 'audio/x-wav', 'audio/wave'].includes(mime ?? '')) {
    await response.body?.cancel();
    throw new Error('GPT-SoVITS must return audio/wav.');
  }
  return decodeWav(await readLimited(response, MAX_WAV_BYTES));
}

/** Reads RIFF chunks; only complete, interleaved PCM16 mono/stereo is accepted. */
export function decodeWav(wav: Buffer): PcmAudio {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Invalid RIFF/WAVE response.');
  }
  const declaredSize = wav.readUInt32LE(4);
  // Streaming WAV headers can leave RIFF/data sizes at 0xffffffff.
  const end = declaredSize === 0xffffffff ? wav.length : declaredSize + 8;
  if (end > wav.length || end < 12) throw new Error('Truncated WAV response.');
  let format: { sampleRate: number; channels: number; blockAlign: number } | undefined;
  let pcm: Buffer | undefined;
  for (let offset = 12; offset + 8 <= end;) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const bytes = size === 0xffffffff && id === 'data' ? end - start : size;
    if (start + bytes > end) throw new Error('Truncated WAV chunk.');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format chunk.');
      const encoding = wav.readUInt16LE(start);
      const channels = wav.readUInt16LE(start + 2);
      const sampleRate = wav.readUInt32LE(start + 4);
      const blockAlign = wav.readUInt16LE(start + 12);
      if (encoding !== 1 || wav.readUInt16LE(start + 14) !== 16
        || ![1, 2].includes(channels) || sampleRate < 8000 || sampleRate > 192000
        || blockAlign !== channels * 2 || wav.readUInt32LE(start + 8) !== sampleRate * blockAlign) {
        throw new Error('WAV must be PCM16 mono/stereo at 8000–192000 Hz.');
      }
      format = { channels, sampleRate, blockAlign };
    } else if (id === 'data') {
      if (pcm) throw new Error('Multiple WAV data chunks are unsupported.');
      pcm = wav.subarray(start, start + bytes);
    }
    offset = start + bytes + (bytes % 2);
  }
  if (!format || !pcm?.length || pcm.length % format.blockAlign !== 0) {
    throw new Error('WAV has no complete PCM frames.');
  }
  return { pcm, sampleRate: format.sampleRate, channels: format.channels };
}
