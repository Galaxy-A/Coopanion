import type { LLMProviderEntry } from 'cortico/core/types.ts';
import type { ProviderWebUiHost } from 'cortico/providers/webui/types.ts';
import { connectionBlocks } from 'cortico/providers/webui/config.ts';
import type { WebUiPageContribution } from 'cortico/web/shared/webui-protocol.ts';
import { plainRemote } from './address.ts';
import { CooModelCatalogError, listCooModels, protocolOf } from './models.ts';
import { cooText } from './strings.ts';
import { PROTOCOLS } from './vendors.ts';

export const CATALOG_PANEL = 'catalog';

interface CatalogInput {
  name?: string;
  entry: LLMProviderEntry;
  secretValue?: string;
}

/** Saved credentials stay bound to their saved URL, protocol and secret variable. */
export function cooCatalog(host: ProviderWebUiHost): Partial<WebUiPageContribution> {
  const blocks = connectionBlocks(host.language);
  const S = cooText(host.language);
  return {
    panels: [blocks.endpoint, { ...blocks.model, id: CATALOG_PANEL }, blocks.pricing, blocks.protocol],
    invoke: async (panel, method, args) => {
      if (panel !== CATALOG_PANEL || method !== 'models' || args.length !== 1) throw new Error(S.catalog.invalid);
      const input = args[0] as CatalogInput | null;
      if (!input || typeof input !== 'object' || Array.isArray(input) || !input.entry || typeof input.entry !== 'object' || Array.isArray(input.entry)) throw new Error(S.catalog.invalid);
      const { entry, name, secretValue } = input;
      if (entry.kind !== 'coo' || typeof entry.baseUrl !== 'string' || name !== undefined && (typeof name !== 'string' || !name)
        || secretValue !== undefined && (typeof secretValue !== 'string' || !secretValue || /\s/.test(secretValue))
        || entry.secret !== undefined && (typeof entry.secret !== 'string' || entry.secret !== '' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.secret))
        || entry.options !== undefined && (!entry.options || typeof entry.options !== 'object' || Array.isArray(entry.options))) throw new Error(S.catalog.invalid);
      let url: URL;
      try { url = new URL(entry.baseUrl); } catch { throw new Error(S.catalog.invalid); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || entry.baseUrl.includes('?') || entry.baseUrl.includes('#')) throw new Error(S.catalog.invalid);
      if (plainRemote(entry.baseUrl)) throw new Error(S.httpRemote);
      const protocol = (entry.options as { protocol?: unknown } | undefined)?.protocol;
      if (protocol !== undefined && !PROTOCOLS.some(value => value === protocol)) throw new Error(S.badProtocol(PROTOCOLS.join(' / ')));
      const saved = name ? host.entries().find(value => value.name === name) : undefined;
      const matches = saved && saved.entry.baseUrl === entry.baseUrl && saved.entry.secret === entry.secret && protocolOf(saved.entry) === protocolOf(entry);
      if (!secretValue && (saved && !matches || !saved && !!entry.secret)) throw new Error(S.catalog.keyRequired);
      try {
        if (matches && !secretValue) {
          const instance = host.instance(saved.name);
          if (!instance.listModels) throw new Error(S.catalog.unsupported);
          return { models: await instance.listModels() };
        }
        return { models: await listCooModels(entry, secretValue) };
      } catch (error) {
        if (error instanceof CooModelCatalogError) throw new Error(S.catalog[error.kind]);
        if (secretValue && error instanceof Error && error.message.includes(secretValue)) throw new Error(error.message.replaceAll(secretValue, '[redacted]'));
        throw error;
      }
    },
  };
}
