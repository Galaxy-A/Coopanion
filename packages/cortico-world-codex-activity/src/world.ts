import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language } from 'cortico/core/language.ts';
import type { ToolDef, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import type { WorldContext } from 'cortico/world.ts';
import { registerPetDisplay } from 'cortico-world-desktop-pet/display';
import { attachCodexBridge, type CodexActivityBridge, type CodexCompletion } from './activity.mjs';
import { codexActivityConfigGroup, type CodexActivityConfigSection } from './config.ts';
import { completionText } from './model-text.ts';
import { strings } from '../web/strings.js';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CodexActivityWorld implements World {
  readonly id = 'codex-activity';
  private bridge: CodexActivityBridge | null = null;
  private display: ReturnType<typeof registerPetDisplay> | null = null;
  private acceptingCompletions = false;
  private completionDelivery: Promise<void> = Promise.resolve();

  constructor(private readonly context: WorldContext<CodexActivityConfigSection>) {}

  envPromptVars(): null { return null; }
  tools(): ToolDef[] { return []; }

  webUi(language: Language = 'zh'): WorldWebUiDecl {
    const text = strings(language);
    const status = this.bridge?.status();
    return {
      label: text.activity,
      lamps: [{ label: text.activity, state: !status ? 'offline' : status.discoveryError ? 'error' : 'online',
        hint: status?.discoveryError || status?.sessionsDir }],
      badges: [{ label: text.activity, value: status?.sessions.length ?? 0 }],
      config: [codexActivityConfigGroup(language)],
    };
  }

  async start(host: WorldHost): Promise<void> {
    const cfg = this.context.cfg;
    if ((cfg.sessionsDir && !isAbsolute(cfg.sessionsDir))
      || !Number.isInteger(cfg.pollMs) || cfg.pollMs < 100 || cfg.pollMs > 60000
      || !Number.isInteger(cfg.maxThreads) || cfg.maxThreads < 1 || cfg.maxThreads > 32) {
      throw new Error('Invalid codex-activity configuration');
    }
    if (this.bridge) return;
    this.acceptingCompletions = true;
    try {
      this.bridge = await attachCodexBridge({
        sessionsDir: cfg.sessionsDir, receiptDir: join(this.context.dataDir, 'worlds', this.id),
        pollMs: cfg.pollMs, maxThreads: cfg.maxThreads, send: () => this.display?.publish(),
        onComplete: cfg.notifyOnComplete ? (completion) => this.deliverCompletion(host, completion) : undefined,
      });
      this.display = registerPetDisplay({
        id: this.id, entry: 'view.js', files: { 'view.js': join(WEB, 'view.js'), 'strings.js': join(WEB, 'strings.js') },
        snapshot: () => this.bridge?.snapshot(),
        onAction: async (value) => {
          const action = value as { kind?: unknown; threadId?: unknown } | null;
          if (action?.kind !== 'open-thread' || typeof action.threadId !== 'string' || !THREAD_ID.test(action.threadId)) return;
          const url = `codex://threads/${action.threadId}`;
          const [command, args] = process.platform === 'win32'
            ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
            : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
          await new Promise<void>((resolve, reject) => {
            const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
            child.once('error', reject);
            child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Codex link opener exited: ${code}`)));
          }).catch((error) => host.log.warn('Codex thread could not be opened', { error: String(error) }));
        },
      });
    } catch (error) { await this.stop(); throw error; }
  }

  private deliverCompletion(host: WorldHost, completion: CodexCompletion): void {
    if (!this.acceptingCompletions) return;
    this.completionDelivery = this.completionDelivery.then(async () => {
      if (!this.acceptingCompletions) return;
      await host.pushEvent({
        type: 'codex-activity.completed', source: this.id, senderKey: this.id,
        ts: nowIso(this.context.timezone), text: completionText(completion),
        meta: { threadId: completion.threadId, turnId: completion.turnId,
          completedAtMs: completion.completedAtMs, title: completion.title },
      }, { trigger: 'preempt' });
    }).catch((error) => host.log.warn('Codex completion could not be delivered', { error: String(error) }));
  }

  async stop(): Promise<void> {
    this.acceptingCompletions = false;
    this.display?.dispose();
    this.display = null;
    const bridge = this.bridge;
    this.bridge = null;
    await bridge?.stop();
    await this.completionDelivery;
  }
}
