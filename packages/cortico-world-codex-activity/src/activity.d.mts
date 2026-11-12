export interface CodexActivityBridge {
  snapshot(): unknown;
  status(): { enabled: boolean; discoveryError: string | null; sessionsDir: string; sessions: unknown[] };
  stop(): Promise<void>;
}
export interface CodexCompletion {
  threadId: string;
  turnId: string;
  completedAtMs: number;
  title: string;
}
export function attachCodexBridge(options: {
  send(packet: unknown): void; sessionsDir: string; receiptDir: string; pollMs: number; maxThreads: number;
  onComplete?(completion: CodexCompletion): void;
}): Promise<CodexActivityBridge>;
