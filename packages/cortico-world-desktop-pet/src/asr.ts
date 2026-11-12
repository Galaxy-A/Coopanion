/** Reusable recognition primitives; importing these does not start the desktop-pet World. */
export { SherpaAsr, SENSEVOICE } from './asr/sherpa.ts';
export { Segmenter } from './asr/segmenter.ts';
export type { Utterance } from './asr/segmenter.ts';
export { looksHallucinated } from './asr/result.ts';
export { RuntimeStore } from './runtime/store.ts';
