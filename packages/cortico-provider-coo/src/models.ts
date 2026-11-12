import Anthropic from '@anthropic-ai/sdk';
import type { LLMProviderEntry } from 'cortico/core/types.ts';
import type { ListedModel } from 'cortico/providers/base.ts';
import { ModelCatalog } from 'cortico/providers/openai-responses-compat/native.ts';
import { listGeminiModels } from './gemini/client.ts';
import { cooText } from './strings.ts';
import { locate, type Protocol } from './vendors.ts';

const MODEL_LIST_MS = 60_000;
const MODEL_REQUEST_MS = 15_000;
const ANTHROPIC_MODELS_MAX = 2000;

export interface CooOptions {
  /** Unset: the listed service's own protocol, Responses for any other URL. */
  protocol?: Protocol;
}

export const protocolOf = (entry: LLMProviderEntry): Protocol =>
  (entry.options as CooOptions | undefined)?.protocol ?? locate(entry.baseUrl)?.site.protocol ?? 'responses';

export class CooModelCatalogError extends Error {
  constructor(readonly kind: 'unsupported' | 'timeout') { super(cooText('en').catalog[kind]); }
}

/** The same bounded, non-redirecting model catalog serves saved connections and unsaved forms. */
export async function listCooModels(entry: LLMProviderEntry, apiKey?: string): Promise<ListedModel[]> {
  const protocol = protocolOf(entry);
  const deadline = AbortSignal.timeout(MODEL_LIST_MS);
  const catalogFetch: typeof fetch = async (input, init) => {
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(MODEL_REQUEST_MS), ...(init?.signal ? [init.signal] : [])]);
    try {
      const response = await fetch(input, { ...init, redirect: 'error', signal });
      if (response.ok && protocol !== 'gemini') {
        const body: unknown = await response.clone().json();
        if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) throw new CooModelCatalogError('unsupported');
        if ((body as { data: unknown[] }).data.some(row => !row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string' || !(row as { id: string }).id.trim())) throw new CooModelCatalogError('unsupported');
      }
      return response;
    } catch (error) {
      if (signal.aborted) throw new CooModelCatalogError('timeout');
      if (error instanceof SyntaxError) throw new CooModelCatalogError('unsupported');
      throw error;
    }
  };
  try {
    let models: ListedModel[];
    if (protocol === 'anthropic') {
      const client = new Anthropic({
        baseURL: entry.baseUrl, apiKey: apiKey ?? '', authToken: null, webhookKey: null,
        maxRetries: 0, timeout: MODEL_REQUEST_MS, logLevel: 'off',
        defaultHeaders: { authorization: null, 'x-api-key': apiKey || null },
        fetch: (url, init) => catalogFetch(url, {
          ...init,
          headers: { 'anthropic-version': '2023-06-01', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
        }),
      });
      models = [];
      for await (const model of client.models.list()) {
        if (models.length >= ANTHROPIC_MODELS_MAX) break;
        if (typeof model.id !== 'string') continue;
        const row = model as typeof model & { max_input_tokens?: number; max_tokens?: number };
        models.push({ id: model.id, displayName: model.display_name,
          ...(row.max_input_tokens ? { contextWindow: row.max_input_tokens } : {}), ...(row.max_tokens ? { maxOutputTokens: row.max_tokens } : {}) });
      }
    } else if (protocol === 'gemini') {
      models = await listGeminiModels(entry.baseUrl, apiKey ?? '', deadline);
    } else {
      const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      models = await new ModelCatalog(() => ({ baseUrl: entry.baseUrl, headers }), catalogFetch).list();
    }
    const stated = locate(entry.baseUrl)?.vendor.contextWindows;
    return models.map(model => stated?.[model.id] ? { ...model, contextWindow: stated[model.id] } : model);
  } catch (error) {
    if (error instanceof Error && error.cause instanceof CooModelCatalogError) throw error.cause;
    if (deadline.aborted || error instanceof Error && /^(AbortError|TimeoutError|APIConnectionTimeoutError)$/.test(error.name)) throw new CooModelCatalogError('timeout');
    if (error instanceof SyntaxError || error instanceof Error && /^GET \/models returned no (data|models) array$/.test(error.message)) throw new CooModelCatalogError('unsupported');
    if (apiKey && error instanceof Error && error.message.includes(apiKey)) throw new Error(error.message.replaceAll(apiKey, '[redacted]'));
    throw error;
  }
}
