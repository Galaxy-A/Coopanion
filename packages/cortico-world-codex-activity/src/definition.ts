import type { WorldDefinition } from 'cortico/world.ts';
import { CODEX_ACTIVITY_DEFAULTS, type CodexActivityConfigSection } from './config.ts';
import { CodexActivityWorld } from './world.ts';

export const CODEX_ACTIVITY: WorldDefinition<CodexActivityConfigSection> = {
  id: 'codex-activity',
  label: 'Codex',
  defaults: () => ({ ...CODEX_ACTIVITY_DEFAULTS }),
  create: (context) => new CodexActivityWorld(context),
  describe: {
    tools: [],
    events: [{
      type: 'codex-activity.completed', trigger: 'preempt',
      description: {
        zh: 'Codex 本轮工作完成，交给当前模型组织提醒。',
        en: 'A Codex turn completed; the current model can compose a reminder.',
      },
    }],
  },
};
