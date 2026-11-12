import type { ProviderHubApi } from 'cortico/providers/hub-api.ts';
import type { ListedModel } from 'cortico/providers/base.ts';
import type { Protocol } from 'cortico-provider-coo/src/vendors.ts';
import { locate } from 'cortico-provider-coo/src/vendors.ts';
import { get, invokePanel, post } from '../../base/api.ts';

export type HubState = ReturnType<ProviderHubApi['list']>;
export type Connection = HubState['providers'][number];
export type Detail = ReturnType<ProviderHubApi['detail']>;
export type Entry = Detail['entry'];
export type { ListedModel };

export interface Probe {
  ok: boolean; status: number | null; elapsedMs: number; model?: string; error?: string; hint?: string;
}

export const connectionPath = (name: string) => `/api/providers/${encodeURIComponent(name)}`;
export const listConnections = (signal: AbortSignal) => get<HubState>('/api/providers', { signal });
export const readConnection = (name: string, signal: AbortSignal) => get<Detail>(connectionPath(name), { signal });
export const protocolOf = (entry: Entry): Protocol =>
  (entry.options?.protocol as Protocol | undefined) ?? locate(entry.baseUrl)?.site.protocol ?? 'responses';

export function requestUrl(baseUrl: string, protocol: Protocol): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return base + ({ responses: '/responses', chat: '/chat/completions', anthropic: '/v1/messages', gemini: '/models/{model}:generateContent' }[protocol]);
}

/** A pasted request URL is reduced to the root expected by the selected protocol. */
export function normalizeUrl(value: string, protocol: Protocol): string {
  const suffix = { responses: /\/responses\/?$/, chat: /\/chat\/completions\/?$/, anthropic: /\/v1\/messages\/?$/, gemini: /\/models\/[^/]+:(?:generateContent|streamGenerateContent)\/?$/ }[protocol];
  return value.trim().replace(suffix, '').replace(/\/+$/, '');
}

export async function saveConnection(name: string, entry: Entry, key: string, saved: Detail | undefined, signal: AbortSignal, copyFrom?: { name: string; revision: string }): Promise<Detail> {
  return post<Detail>(saved ? connectionPath(saved.name) + '/save' : '/api/providers', {
    name, entry, ...(saved ? { expectedRevision: saved.revision } : copyFrom ? { copyFrom } : {}), ...(key.trim() ? { secretValue: key.trim() } : {}),
  }, { signal });
}

export const probeConnection = (name: string, signal: AbortSignal, draft?: { entry: Entry; secretValue?: string }) =>
  post<Probe>(connectionPath(name) + '/test', draft ?? {}, { signal });

export const fetchModels = (entry: Entry, key: string, name: string | undefined, signal: AbortSignal) =>
  invokePanel<{ models: ListedModel[] }>('llm:coo', 'catalog', 'models', [{
    entry, ...(name ? { name } : {}), ...(key.trim() ? { secretValue: key.trim() } : {}),
  }], { signal });

export async function useConnection(name: string, signal: AbortSignal): Promise<void> {
  await post(connectionPath(name) + '/activate', {}, { signal });
  await post('/api/run/resume', {}, { signal });
}
