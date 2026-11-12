import type { ConfigGroup } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import { strings } from '../web/strings.js';

export interface CodexActivityConfigSection {
  enabled: boolean;
  sessionsDir: string;
  pollMs: number;
  maxThreads: number;
  notifyOnComplete: boolean;
}

export const CODEX_ACTIVITY_DEFAULTS: CodexActivityConfigSection = {
  enabled: false, sessionsDir: '', pollMs: 400, maxThreads: 32, notifyOnComplete: true,
};

export function codexActivityConfigGroup(language: Language = 'zh'): ConfigGroup {
  const text = strings(language);
  return {
    id: 'world:codex-activity', owner: 'world:codex-activity',
    schema: {
      type: 'object', title: text.activity,
      properties: {
        'worlds.codex-activity.notifyOnComplete': {
          type: 'boolean', title: text.notifyOnComplete, description: text.completionHint, 'x-hot': false,
        },
        'worlds.codex-activity.sessionsDir': {
          type: 'string', title: text.sessionsDir, description: text.sessionsHint, 'x-hot': false,
        },
        'worlds.codex-activity.pollMs': {
          type: 'integer', title: text.pollMs, minimum: 100, maximum: 60000, 'x-hot': false,
        },
        'worlds.codex-activity.maxThreads': {
          type: 'integer', title: text.maxThreads, minimum: 1, maximum: 32, 'x-hot': false,
        },
      },
    },
  };
}
