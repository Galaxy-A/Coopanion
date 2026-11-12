import type { ToolSpec } from 'cortico/core/types.ts';

export function addressCue(transcript: string, configuredKeyword: string) {
  const keyword = configuredKeyword.trim();
  if (!keyword) return null;
  const normalized = (text: string) => text.normalize('NFKC').toLowerCase();
  return { keyword, matched: normalized(transcript).includes(normalized(keyword)) };
}

export function speechContent(transcript: string, configuredKeyword: string) {
  const cue = addressCue(transcript, configuredKeyword);
  return {
    text: [
      '[heybox.speech] HeyBox voice room | reply audio: heybox_say',
      ...(cue ? [`HeyBox address cue: ${JSON.stringify(cue)}`] : []),
      'Transcript:',
      transcript,
    ].join('\n'),
    meta: {
      transcript,
      ...(cue ? { addressKeyword: cue.keyword, addressKeywordMatched: cue.matched } : {}),
    },
  };
}

export const HEYBOX_TOOL_DECLS: readonly ToolSpec[] = [
  {
    name: 'heybox_say',
    description: 'Speak to HeyBox voice-room participants, including replies to heybox.speech. This tool both synthesizes through the existing GPT-SoVITS HTTP service and sends the audio into the configured HeyBox microphone or explicit output device. For room replies use this instead of sovits_speak, which plays locally; do not synthesize the same line twice. Waits for audio consumption; completion does not confirm room delivery.',
    tags: ['write'],
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { text: { type: 'string', minLength: 1, maxLength: 2000, description: 'Plain text to speak.' } },
      required: ['text'],
    },
  },
  {
    name: 'heybox_hush',
    description: 'Cancel the current HeyBox synthesis request, stop injected or device speech and cancel all queued utterances. The microphone remains usable. The HTTP server may continue inference after the client disconnects.',
    tags: ['write'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'heybox_status',
    description: 'Refresh GPT-SoVITS HTTP readiness, Windows audio devices, microphone processing and HeyBox processes. Reports bridge, capture, recognition and operator-confirmed setup status. Audio consumption alone does not confirm room delivery.',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
];

export function receiveRoute(enabled: boolean): string {
  return enabled
    ? 'The operator has designated desktop-pet voice input as incoming HeyBox room speech. Its transcripts are external participants, with no authenticated speaker identity.'
    : 'Incoming HeyBox process audio arrives as heybox.speech while the operator has started the bridge. Desktop-pet microphone input keeps its existing meaning.';
}
