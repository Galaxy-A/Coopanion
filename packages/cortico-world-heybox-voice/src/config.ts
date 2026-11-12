import type { ConfigGroup } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import { strings } from './strings.ts';

export interface HeyboxConfigSection {
  enabled: boolean;
  baseUrl: string;
  outputDevice: string;
  sendMode: 'microphone' | 'device';
  microphoneEndpoint: string;
  voice: string;
  speed: number;
  timeoutMs: number;
  receiveViaDesktopPet: boolean;
  processPid: number;
  recognitionLanguage: string;
  thresholdDb: number;
  addressKeyword: string;
}

export const HEYBOX_DEFAULTS: HeyboxConfigSection = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:9880',
  outputDevice: '',
  sendMode: 'device',
  microphoneEndpoint: '',
  voice: '',
  speed: 1,
  timeoutMs: 120_000,
  receiveViaDesktopPet: false,
  processPid: 0,
  recognitionLanguage: 'auto',
  thresholdDb: -42,
  addressKeyword: '',
};

export const HEYBOX_SECRETS = { ttsToken: 'HEYBOX_TTS_TOKEN' } as const;

export function heyboxConfigGroup(language: Language): ConfigGroup {
  const s = strings(language);
  const key = 'worlds.heybox';
  return {
    id: 'world:heybox',
    owner: 'world:heybox',
    schema: {
      type: 'object',
      title: s.title,
      properties: {
        [`${key}.baseUrl`]: { type: 'string', title: s.endpoint, 'x-hot': true },
        [`${key}.outputDevice`]: { type: 'string', title: s.device, 'x-hot': true },
        [`${key}.sendMode`]: { type: 'string', title: s.sendMode, enum: ['microphone', 'device'],
          description: `microphone: ${s.microphoneMode}; device: ${s.deviceMode}`, 'x-hot': true },
        [`${key}.microphoneEndpoint`]: { type: 'string', title: s.microphoneDevice,
          description: s.micPrivacyHint, 'x-warning': true, 'x-hot': true },
        [`${key}.voice`]: { type: 'string', title: s.voice, 'x-hot': true },
        [`${key}.speed`]: { type: 'number', title: s.speed, minimum: 0.5, maximum: 2, 'x-hot': true },
        [`${key}.timeoutMs`]: { type: 'integer', title: s.timeout, minimum: 1000, maximum: 180000, 'x-hot': true },
        [`${key}.receiveViaDesktopPet`]: { type: 'boolean', title: s.receive, description: s.inputHint, 'x-hot': true },
        [`${key}.processPid`]: { type: 'integer', title: s.process, minimum: 0, 'x-hot': true },
        [`${key}.recognitionLanguage`]: { type: 'string', title: s.language, enum: ['auto', 'zh', 'en', 'ja', 'ko', 'yue'], 'x-hot': true },
        [`${key}.thresholdDb`]: { type: 'number', title: s.threshold, minimum: -80, maximum: -10, 'x-hot': true },
        [`${key}.addressKeyword`]: { type: 'string', title: s.addressKeyword, description: s.keywordHint, 'x-hot': true },
      },
    },
  };
}
