import type { CodexCompletion } from './activity.mjs';

export function completionText(completion: CodexCompletion): string {
  return [
    'Codex has completed its current turn.',
    `Task title (data): ${JSON.stringify(completion.title)}.`,
    'Let the user know in your own words, following your usual language, personality, and the enabled Worlds’ speech and action instructions.',
  ].join('\n');
}
