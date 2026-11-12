import { join } from 'node:path';
import { modelsRoot, runtimesRoot } from 'cortico/paths.ts';
import type { Logger } from 'cortico/core/types.ts';
import { RuntimeStore, SherpaAsr, SENSEVOICE, Segmenter, looksHallucinated } from 'cortico-world-desktop-pet/asr';
import { startProcessCapture, type ProcessCapture } from './capture.ts';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Owns recognition and capture for one process tree. Check mode never emits Core events. */
export class Receiver {
  readonly store = new RuntimeStore({ runtimesRoot, modelsDir: () => join(modelsRoot(), 'desktop-pet') });
  private asr: SherpaAsr | null = null;
  private capture: ProcessCapture | null = null;
  private controller: AbortController | null = null;
  private decode: Promise<void> = Promise.resolve();
  private pending = 0;
  private mode: 'check' | 'bridge' | null = null;
  private phase = 'stopped';
  private error = '';
  private lastText = '';
  private recognized = 0;
  private dropped = 0;
  private levelDb = -100;

  constructor(private readonly language: () => string, private readonly threshold: () => number,
    private readonly onText: (text: string, pid: number, mode: 'check' | 'bridge') => Promise<void>) {}

  state() {
    return { phase: this.phase, mode: this.mode, error: this.error, lastText: this.lastText,
      recognized: this.recognized, dropped: this.dropped, levelDb: this.levelDb,
      capture: this.capture?.getStatus() ?? null, model: this.store.funasr.state() };
  }

  async start(pid: number, mode: 'check' | 'bridge', log: Logger, signal?: AbortSignal): Promise<void> {
    await this.stop();
    signal?.throwIfAborted();
    if (this.store.funasr.state().phase !== 'ready') throw new Error('Download the speech recognition model first.');
    const controller = new AbortController();
    this.controller = controller;
    const aborted = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
    this.mode = mode;
    this.phase = 'starting';
    this.error = '';
    this.lastText = '';
    const asr = new SherpaAsr({ kind: SENSEVOICE, model: () => ({ paths: this.store.funasr.paths() }),
      language: this.language, threads: () => 2, log });
    this.asr = asr;
    try {
      await asr.start();
      controller.signal.throwIfAborted();
      if (asr.state().phase !== 'running') throw new Error(asr.state().detail || 'Speech recognizer did not start.');
      const segmenter = new Segmenter({ thresholdDb: this.threshold(), minSpeechMs: 120,
        dispatchSilenceMs: 700, silenceMs: 700, maxUtteranceMs: 15000, preRollMs: 200,
        minUtteranceMs: 300 }, 20);
      const capture = await startProcessCapture(pid, (bytes) => {
        if (controller.signal.aborted) return;
        const pcm = new Int16Array(bytes.length / 2);
        for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readInt16LE(i * 2);
        for (const utterance of segmenter.push(pcm)) {
          if (this.pending >= 4) { this.dropped++; this.error = 'Recognition queue full; an audio segment was dropped.'; continue; }
          this.pending++;
          this.decode = this.decode.then(async () => {
            if (controller.signal.aborted) return;
            const result = await asr.transcribe(utterance.pcm);
            if (controller.signal.aborted) return;
            if (result.error) { this.error = result.error; return; }
            if (looksHallucinated(result.text)) return;
            this.lastText = result.text;
            this.recognized++;
            await this.onText(result.text, pid, mode);
          }).catch((error) => { this.error = message(error); })
            .finally(() => { this.pending--; });
        }
        this.levelDb = segmenter.level;
      }, controller.signal);
      this.capture = capture;
      this.phase = 'running';
      void capture.done.then(() => {
        if (!controller.signal.aborted) {
          this.phase = 'error';
          this.error = 'HeyBox process capture ended. Refresh processes and start the bridge again.';
        }
      }, (error) => {
        if (!controller.signal.aborted) { this.phase = 'error'; this.error = message(error); }
      }).finally(() => {
        if (!controller.signal.aborted) {
          controller.abort();
          void this.decode.then(() => asr.stop()).catch((error) => log.warn(message(error)));
        }
      });
    } catch (error) {
      controller.abort();
      await Promise.allSettled([this.capture?.stop(), asr.stop()]);
      this.phase = 'error';
      this.error = message(error);
      throw error;
    } finally {
      signal?.removeEventListener('abort', aborted);
    }
  }

  cancel(): void {
    this.controller?.abort();
    if (this.phase === 'running' || this.phase === 'starting') this.phase = 'stopping';
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    const capture = await Promise.allSettled([this.capture?.stop()]);
    await this.decode;
    const asr = await Promise.allSettled([this.asr?.stop()]);
    this.controller = null;
    this.capture = null;
    this.asr = null;
    this.mode = null;
    this.phase = 'stopped';
    this.levelDb = -100;
    for (const result of [...capture, ...asr]) {
      if (result.status === 'rejected') this.error = message(result.reason);
    }
  }
}
