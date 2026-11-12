import { CHATGPT_MODULE } from 'cortico-provider-coo/src/vendors.ts';
import { modalCard, openLayer } from '../../../../shared/ui/modal.ts';
import { get } from '../../../base/api.ts';
import { Lifecycle } from '../../../base/lifecycle.ts';
import { dialogEnvironment } from '../../../base/ui/index.ts';
import { icon } from '../../../base/ui/icons.ts';
import { S as COMMON } from '../../../base/ui/strings.ts';
import type { ModuleEditor } from '../../../features/connections/index.ts';
import { S as POOL_TEXT } from '../../../features/connections/strings.ts';
import type { FeatureContext } from '../feature.ts';
import { mountDetail, type DetailController } from './detail.ts';
import { NEW_DRAFT_ID, providerDrafts } from './drafts.ts';
import type { Detail, Editing, HubState, Module } from './types.ts';

/** Extension modules keep their declared fields and panels in the shared provider pool. */
export async function createModuleEditor(ctx: FeatureContext): Promise<ModuleEditor> {
  const modules = (await get<Module[]>('/api/provider-modules', { signal: ctx.signal }))
    .filter(module => module.id !== 'coo' && module.id !== CHATGPT_MODULE);
  let pending: Promise<void> | undefined;
  return {
    modules,
    open(options) {
      if (pending) return pending;
      pending = show(options).finally(() => { pending = undefined; });
      return pending;
    },
  };

  async function show(options: Parameters<ModuleEditor['open']>[0]): Promise<void> {
    const state = await get<HubState>('/api/providers', { signal: ctx.signal });
    if (ctx.signal.aborted) return;
    const { ui } = ctx;
    const env = { ...dialogEnvironment(ui), signal: ctx.signal };
    const previousFocus = env.doc.activeElement as HTMLElement | null;
    const drafts = providerDrafts(env.doc.defaultView!.localStorage, state.scope);
    let saved: Detail | null = options.saved ?? null;
    let identity = saved?.name ?? NEW_DRAFT_ID;
    let draft: Editing | null = drafts.get(identity);
    if (!saved && draft?.entry.kind !== options.kind) draft = null;
    if (!saved && !draft) {
      const module = modules.find(item => item.id === options.kind);
      draft = {
        original: null, name: '', secretValue: '', raw: {},
        entry: {
          kind: options.kind!, baseUrl: module?.defaultBaseUrl ?? '',
          spec: {
            model: '', thinking: module?.reasoningTiers[0]?.thinking ?? true,
            ...(module?.reasoningTiers[0]?.effort ? { reasoningEffort: module.reasoningTiers[0].effort } : {}),
          },
        },
      };
    }
    let resolveClosed: () => void = () => {};
    const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const lifetime = new Lifecycle(ctx.onError);
    let controller: DetailController | undefined;
    let dirty = false;
    let confirming = false;
    let generation = 0;
    const backdrop = ui.h('div', 'modal');
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    const layer = openLayer(env, backdrop, () => {
      generation++;
      controller?.dispose();
      lifetime.dispose();
      previousFocus?.focus();
      resolveClosed();
    });
    const { card, head, body } = modalCard(env, layer, saved ? POOL_TEXT.edit : POOL_TEXT.add);
    card.classList.add('provider-module-editor');
    const requestClose = async () => {
      if (confirming || layer.signal.aborted) return;
      confirming = true;
      try {
        if (dirty) {
          if (!await ui.confirm({ title: POOL_TEXT.discard, danger: true })) return;
          drafts.remove(identity);
        }
        layer.close();
      }
      finally { confirming = false; }
    };
    const close = ui.button('', { size: 'sm', onClick: () => void requestClose() });
    close.classList.add('pool-icon');
    close.title = COMMON.cancel; close.setAttribute('aria-label', COMMON.cancel);
    close.append(icon(env.doc, 'close'));
    head.append(close);
    env.doc.addEventListener('keydown', event => {
      if (event.key === 'Escape' && [...env.host.querySelectorAll(':scope > .modal')].at(-1) === backdrop) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void requestClose();
      }
    }, { signal: layer.signal });
    backdrop.addEventListener('mousedown', event => {
      if (event.target === backdrop) void requestClose();
    }, { signal: layer.signal });
    lifetime.own(ctx.router.addLeaveGuard(() => dirty ? POOL_TEXT.discard : null));
    const finish = async (name: string) => {
      drafts.remove(identity);
      dirty = false;
      await options.onSaved(name);
      layer.close();
    };
    const render = async (): Promise<void> => {
      const current = ++generation;
      controller?.dispose();
      body.replaceChildren();
      head.querySelector('.modaltitle')!.textContent = saved ? POOL_TEXT.edit : POOL_TEXT.add;
      const host = ui.h('div', 'connection-detail');
      host.style.setProperty('--provider-edge', '0px');
      body.append(host);
      const mounted = await mountDetail({
        ctx: { ...ctx, root: host, lifecycle: lifetime, signal: layer.signal },
        root: host, modules, saved, draft,
        changed(editing, _invalid, changed) {
          if (layer.signal.aborted) return;
          draft = editing; dirty = changed;
          if (changed) drafts.set(editing); else drafts.remove(identity);
        },
        onSaved: name => finish(name),
        cancelled: requestClose,
        deleted: () => finish(saved!.name),
        duplicate: async editing => {
          const latest = await get<HubState>('/api/providers', { signal: layer.signal });
          if (dirty && draft) drafts.set(draft);
          const names = new Set(latest.providers.map(item => item.name.toLowerCase()));
          const base = editing.name.slice(0, 56);
          let name = base, number = 2;
          while (names.has(name.toLowerCase())) name = `${base}-${number++}`;
          editing.name = name;
          saved = null; identity = NEW_DRAFT_ID; draft = editing;
          await render();
        },
      });
      if (layer.signal.aborted || current !== generation) mounted.dispose();
      else controller = mounted;
    };
    try { await render(); }
    catch (error) { layer.close(); throw error; }
    await closed;
  }
}
