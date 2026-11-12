import { fileURLToPath } from 'node:url';
import type { Language } from 'cortico/core/language.ts';
import type { ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import { HEYBOX_SECRETS, heyboxConfigGroup, type HeyboxConfigSection } from './config.ts';
import { HEYBOX_TOOL_DECLS, receiveRoute, speechContent, addressCue } from './model-text.ts';
import { listAudioDevices, playPcm, type AudioDevice } from './audio.ts';
import { getHealth, synthesize } from './tts.ts';
import { strings } from './strings.ts';
import { nowIso } from 'cortico/core/util.ts';
import { listHeyboxProcesses, type HeyboxProcess } from './capture.ts';
import { Receiver } from './receive.ts';
import { Setup } from './setup.ts';
import { MicrophoneSetup } from './microphone-setup.ts';
import { injectMicrophone, microphoneStatus } from './microphone.ts';

type Phase = 'idle' | 'synthesizing' | 'playing';
const why = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class HeyboxWorld implements World {
  readonly id = 'heybox';
  private host: WorldHost | null = null;
  private lifetime = new AbortController();
  private tail: Promise<void> = Promise.resolve();
  private jobs = new Set<AbortController>();
  private phase: Phase = 'idle';
  private devices: AudioDevice[] = [];
  private deviceError = '';
  private health = { ready: false, state: '' };
  private processes: HeyboxProcess[] = [];
  private processError = '';
  private transition: Promise<void> = Promise.resolve();
  private receiveRequest: AbortController | null = null;
  private readonly setup: Setup;
  private readonly receiver: Receiver;
  private readonly microphoneSetup: MicrophoneSetup;
  private microphone = { ready: false, active: 0, detail: '' };

  constructor(private readonly context: WorldContext<HeyboxConfigSection>) {
    this.setup = new Setup(context.dataDir);
    this.microphoneSetup = new MicrophoneSetup(context.dataDir);
    this.receiver = new Receiver(() => context.cfg.recognitionLanguage ?? 'auto',
      () => context.cfg.thresholdDb ?? -42, async (text, pid, mode) => {
        await this.setup.received();
        if (mode !== 'bridge' || !this.host) return;
        const content = speechContent(text, context.cfg.addressKeyword ?? '');
        await this.host.pushEvent({ type: 'heybox.speech', source: 'heybox', senderKey: 'heybox.speech',
          ts: nowIso(context.timezone), text: content.text,
          meta: { pid, capture: 'process-tree', external: true, speakerIdentity: 'unknown', ...content.meta } }, { trigger: 'flush' });
      });
  }

  envPromptVars(): Record<string, string> {
    return {
      'heybox.outputDevice': this.usingMicrophone()
        ? `microphone endpoint ${this.context.cfg.microphoneEndpoint || '(unconfigured)'}`
        : this.context.cfg.outputDevice || '(unconfigured)',
      'heybox.receiveRoute': receiveRoute(this.context.cfg.receiveViaDesktopPet),
    };
  }

  tools(): ToolDef[] {
    return HEYBOX_TOOL_DECLS.map((decl) => ({
      ...decl,
      ...(decl.name === 'heybox_say' ? { interruptible: true } : {}),
      handler: async (args, context) => {
        if (decl.name === 'heybox_say') {
          if (!this.bridging()) return { failed: true, text: 'HeyBox bridge is stopped. The operator must start it in the voice panel.' };
          return this.say(args.text, context.signal);
        }
        if (decl.name === 'heybox_hush') {
          await this.hush();
          return 'HeyBox speech stopped; pending utterances cancelled. The microphone remains usable.';
        }
        await this.refresh(context.signal);
        return JSON.stringify(this.snapshot());
      },
    }));
  }

  webUi(language: Language = 'zh'): WorldWebUiDecl {
    const s = strings(language);
    const output = this.outputReady();
    return {
      label: s.title,
      lamps: [
        { label: s.service, state: !this.host ? 'offline' : this.health.ready ? 'online' : 'error',
          hint: this.health.state },
        { label: s.sendRoute, state: !this.host ? 'offline' : this.deviceError ? 'error' : output ? 'online' : 'offline',
          hint: this.deviceError || (this.usingMicrophone()
            ? this.microphone.detail || s.microphoneMode : this.context.cfg.outputDevice || s.choose) },
      ],
      badges: [
        { label: s.title, value: s[this.phase] },
        { label: s.queue, value: Math.max(0, this.jobs.size - (this.phase === 'idle' ? 0 : 1)) },
      ],
      config: [heyboxConfigGroup(language)],
      promptDocs: [{
        key: 'worlds.heybox.envPrompt',
        title: `${s.title} · ${s.prompt}`,
        description: s.inputHint,
        path: fileURLToPath(new URL(language === 'zh' || language === 'zh-Hant' ? './ENV_PROMPT.md' : './ENV_PROMPT.en.md', import.meta.url)),
        role: 'envPrompt',
        vars: [
          { name: 'heybox.outputDevice', description: s.sendRoute },
          { name: 'heybox.receiveRoute', description: s.receive },
        ],
      }],
      panels: [{ id: 'bridge', title: s.title }],
      invoke: async (panel, method, args) => {
        if (panel !== 'bridge') throw new Error('Unknown HeyBox panel.');
        if (method === 'state') {
          if (this.usingMicrophone()) await this.refreshMicrophone();
          return { ...this.snapshot(), labels: s };
        }
        if (method === 'refresh' || method === 'configure') {
          await this.refresh();
          const suggestion = this.setup.state(this.devices, this.context.cfg.outputDevice).suggestedOutput;
          if (method === 'configure' && !this.context.cfg.microphoneEndpoint
            && (this.usingMicrophone() || !this.context.cfg.outputDevice)) {
            const device = this.microphoneSetup.state().devices.find((candidate) => candidate.isDefault);
            if (device) this.context.persist({ sendMode: 'microphone', microphoneEndpoint: device.id });
          } else if (method === 'configure' && !this.usingMicrophone() && !this.context.cfg.outputDevice && suggestion) {
            this.context.persist({ outputDevice: suggestion });
          }
          return { ...this.snapshot(), labels: s };
        }
        if (method === 'stop') { await this.hush(); return { ...this.snapshot(), labels: s }; }
        if (method === 'endCheck') {
          await this.move(async () => { if (this.receiver.state().mode === 'check') await this.receiver.stop(); });
          return { ...this.snapshot(), labels: s };
        }
        if (method === 'install') { this.setup.install(); return { ...this.snapshot(), labels: s }; }
        if (method === 'installMicrophone') {
          this.microphoneSetup.install();
          return { ...this.snapshot(), labels: s };
        }
        if (method === 'configureMicrophone' || method === 'removeMicrophone' || method === 'openMicrophoneConfigurator') {
          if (this.bridging() || this.jobs.size) throw new Error('Stop the bridge and speech before changing microphone processing.');
          if (method === 'configureMicrophone') {
            await this.microphoneSetup.configure(this.context.cfg.microphoneEndpoint);
            await this.microphoneSetup.openConfigurator();
          } else if (method === 'removeMicrophone') await this.microphoneSetup.remove();
          else await this.microphoneSetup.openConfigurator();
          await this.refresh();
          return { ...this.snapshot(), labels: s };
        }
        if (method === 'downloadModel') { void this.receiver.store.funasr.install(); return { ...this.snapshot(), labels: s }; }
        if (method === 'confirmSend') { await this.setup.confirmSend(this.routeKey()); return { ...this.snapshot(), labels: s }; }
        if (method === 'checkReceive' || method === 'startBridge' || method === 'stopBridge') {
          this.receiveRequest?.abort();
          this.receiver.cancel();
          const request = new AbortController();
          this.receiveRequest = request;
          if (method === 'stopBridge') await this.hush();
          await this.move(async () => {
            if (method === 'stopBridge') { await this.receiver.stop(); await this.hush(); return; }
            await this.receiver.stop();
            await this.refresh();
            request.signal.throwIfAborted();
            this.lifetime.signal.throwIfAborted();
            const setup = this.setup.state(this.devices, this.routeKey());
            if (!setup.supported) throw new Error('Process audio capture requires Windows build 20348 or later.');
            if (method === 'startBridge' && (!this.health.ready || !this.outputReady() || !setup.sendConfirmedAt || !setup.receiveAt || this.sendRestartRequired())) {
              throw new Error('Complete speech service, device and send/receive checks first.');
            }
            if (!this.host) throw new Error('HeyBox World is not mounted.');
            const selected = this.context.cfg.processPid
              ? this.processes.find((candidate) => candidate.pid === this.context.cfg.processPid)
              : this.processes.length === 1 ? this.processes[0] : undefined;
            if (!selected) throw new Error('Open HeyBox and select one process if multiple instances are running.');
            await this.receiver.start(selected.pid, method === 'startBridge' ? 'bridge' : 'check', this.host.log,
              AbortSignal.any([request.signal, this.lifetime.signal]));
          });
          return { ...this.snapshot(), labels: s };
        }
        if (method === 'say') {
          const result = await this.say(args[0], undefined, true);
          return { ...this.snapshot(), labels: s, failed: result.failed === true };
        }
        throw new Error('Unknown HeyBox panel method.');
      },
    };
  }

  async start(host: WorldHost): Promise<void> {
    if (this.host) return;
    if (process.platform !== 'win32') throw new Error('HeyBox voice routing requires Windows.');
    this.host = host;
    this.lifetime = new AbortController();
    await this.setup.load(this.lifetime.signal);
    await this.microphoneSetup.load(this.lifetime.signal);
    await this.refresh();
  }

  async stop(): Promise<void> {
    this.host = null;
    this.lifetime.abort();
    this.receiveRequest?.abort();
    this.receiver.cancel();
    await this.move(() => this.receiver.stop());
    await this.hush();
    await this.setup.close();
    await this.microphoneSetup.close();
    this.health = { ready: false, state: '' };
    this.devices = [];
  }

  private bridging(): boolean {
    const state = this.receiver.state();
    return state.phase === 'running' && state.mode === 'bridge';
  }

  private move(action: () => Promise<void>): Promise<void> {
    const next = this.transition.catch(() => {}).then(action);
    this.transition = next;
    return next;
  }

  private outputReady(): boolean {
    if (this.usingMicrophone()) {
      const setup = this.microphoneSetup.state();
      return !setup.busy && setup.pluginInstalled
        && setup.configuredEndpoint === this.context.cfg.microphoneEndpoint && this.microphone.ready;
    }
    return !!this.context.cfg.outputDevice
      && this.devices.filter((device) => device.direction === 'output' && device.name === this.context.cfg.outputDevice).length === 1;
  }

  private usingMicrophone(): boolean { return this.context.cfg.sendMode === 'microphone'; }

  private routeKey(): string {
    return this.usingMicrophone() ? `microphone:${this.context.cfg.microphoneEndpoint}` : this.context.cfg.outputDevice;
  }

  private sendRestartRequired(): boolean {
    return this.usingMicrophone() ? this.microphoneSetup.state().restartRequired
      : this.setup.state(this.devices, this.context.cfg.outputDevice).restartRequired;
  }

  private async refreshMicrophone(signal?: AbortSignal): Promise<void> {
    if (!this.host || !this.usingMicrophone()) return;
    const combined = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    this.microphone = await microphoneStatus(this.microphoneSetup.token, combined)
      .catch((error: unknown) => ({ ready: false, active: 0, detail: why(error) }));
  }

  private snapshot() {
    const receive = this.receiver.state();
    return {
      mounted: this.host !== null,
      phase: this.phase,
      queued: Math.max(0, this.jobs.size - (this.phase === 'idle' ? 0 : 1)),
      health: this.health,
      deviceError: this.deviceError,
      outputReady: this.outputReady(),
      sendRestartRequired: this.sendRestartRequired(),
      devices: this.devices,
      config: { ...this.context.cfg },
      receiveViaDesktopPet: this.context.cfg.receiveViaDesktopPet,
      processes: this.processes,
      processError: this.processError,
      receive,
      addressCue: receive.lastText ? addressCue(receive.lastText, this.context.cfg.addressKeyword ?? '') : null,
      bridging: this.bridging(),
      setup: this.setup.state(this.devices, this.routeKey()),
      microphone: this.microphone,
      microphoneSetup: this.microphoneSetup.state(),
    };
  }

  private async refresh(signal?: AbortSignal): Promise<void> {
    if (!this.host) return;
    const lifetime = this.lifetime;
    const combined = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
    const cfg = { ...this.context.cfg };
    await this.microphoneSetup.refresh(combined);
    const [audio, health, processes] = await Promise.allSettled([
      listAudioDevices(combined),
      getHealth(cfg, this.context.secret(HEYBOX_SECRETS.ttsToken), combined),
      listHeyboxProcesses(combined),
    ]);
    if (lifetime.signal.aborted || this.lifetime !== lifetime) return;
    if (audio.status === 'fulfilled') { this.devices = audio.value; this.deviceError = ''; }
    else { this.devices = []; this.deviceError = why(audio.reason); }
    this.health = health.status === 'fulfilled' ? health.value : { ready: false, state: why(health.reason) };
    this.processes = processes.status === 'fulfilled' ? processes.value : [];
    this.processError = processes.status === 'rejected' ? why(processes.reason) : '';
    await this.refreshMicrophone(combined);
  }

  private async say(value: unknown, signal?: AbortSignal, recordSetup = false): Promise<ToolOutcome> {
    if (!this.host) return { failed: true, text: 'HeyBox World is not mounted.' };
    if (typeof value !== 'string' || !value.trim() || [...value].length > 2000) {
      return { failed: true, text: 'Speech text must contain 1–2000 characters.' };
    }
    if (this.jobs.size >= 8) return { failed: true, text: 'HeyBox speech queue is full (8 utterances).' };
    const controller = new AbortController();
    const combined = AbortSignal.any([controller.signal, this.lifetime.signal, ...(signal ? [signal] : [])]);
    this.jobs.add(controller);
    const task = this.tail.then(async (): Promise<ToolOutcome> => {
      let stage: 'routing' | 'synthesis' | 'playback' = 'routing';
      try {
        combined.throwIfAborted();
        const cfg = { ...this.context.cfg };
        const viaMicrophone = cfg.sendMode === 'microphone';
        const route = viaMicrophone ? `microphone:${cfg.microphoneEndpoint}` : cfg.outputDevice;
        if (viaMicrophone) {
          await this.refreshMicrophone(combined);
          const setup = this.microphoneSetup.state();
          if (setup.busy) throw new Error('Microphone audio configuration is still in progress.');
          if (!cfg.microphoneEndpoint || !setup.pluginInstalled || setup.configuredEndpoint !== cfg.microphoneEndpoint) {
            throw new Error('Configure the selected microphone with the free audio component first.');
          }
          if (!this.microphone.ready) throw new Error('Microphone processing is not active. Open HeyBox microphone testing and check Equalizer APO device selection.');
        } else {
          if (!cfg.outputDevice.trim()) throw new Error('Select the virtual output device connected to the HeyBox microphone first.');
          const devices = await listAudioDevices(combined);
          this.devices = devices;
          if (devices.filter((device) => device.direction === 'output' && device.name === cfg.outputDevice).length !== 1) {
            throw new Error('Configured output device is missing or ambiguous; no audio was played.');
          }
        }
        this.deviceError = '';
        stage = 'synthesis';
        this.phase = 'synthesizing';
        const audio = await synthesize(value.trim(), cfg, this.context.secret(HEYBOX_SECRETS.ttsToken), combined);
        combined.throwIfAborted();
        this.health = { ready: true, state: '' };
        stage = 'playback';
        this.phase = 'playing';
        if (viaMicrophone) await injectMicrophone(audio, this.microphoneSetup.token, combined);
        else await playPcm(audio, cfg.outputDevice, combined);
        this.deviceError = '';
        if (recordSetup) await this.setup.played(route);
        return { text: `${viaMicrophone ? 'Mixed' : 'Played'} ${Math.round(audio.pcm.length / (audio.channels * 2 * audio.sampleRate) * 1000)} ms ${viaMicrophone ? `into microphone "${cfg.microphoneEndpoint}"` : `on "${cfg.outputDevice}"`}. HeyBox room delivery is not confirmed.` };
      } catch (error) {
        if (combined.aborted) return { failed: true, text: 'HeyBox utterance cancelled; playback stopped.' };
        if (stage === 'synthesis') this.health = { ready: false, state: why(error) };
        else this.deviceError = why(error);
        this.host?.log.warn('HeyBox voice failed', { stage, error: why(error) });
        return { failed: true, text: `HeyBox voice failed: ${why(error)}` };
      } finally {
        this.jobs.delete(controller);
        this.phase = 'idle';
      }
    });
    this.tail = task.then(() => {});
    return task;
  }

  private async hush(): Promise<void> {
    const pending = this.tail;
    for (const job of this.jobs) job.abort();
    await pending;
  }
}
