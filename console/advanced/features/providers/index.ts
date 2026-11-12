import { listProblem } from '../../../base/ui/problem.ts';
import { S as COMMON } from '../../../base/ui/strings.ts';
import { pageIntro } from '../../../base/ui/page.ts';
import { pageTabs } from '../../../base/ui/page-tabs.ts';
import { mountExtensionContent } from '../extensions/index.ts';
import type { FeatureContext, FrameworkFeature } from '../feature.ts';
import { S } from './strings.ts';
import { Lifecycle } from '../../../base/lifecycle.ts';
import { readMode } from '../../../features/mode.ts';
import { mountConnectionPool } from '../../../features/connections/index.ts';
import { S as POOL_TEXT } from '../../../features/connections/strings.ts';
import { createModuleEditor } from './module-editor.ts';

export function mountProviders(ctx: FeatureContext): void {
  const { root, ui, router, signal } = ctx;
  const intro = pageIntro(ui, S.pageTitle);
  const pool = ui.h('div', 'provider-pool');
  const market = ui.h('div', 'provider-market');
  const panes = { pool, market };
  const advancedMode = readMode() === 'advanced';
  let current: keyof typeof panes | undefined;
  let viewLife: Lifecycle | undefined;
  let poolController: Awaited<ReturnType<typeof mountConnectionPool>> | undefined;
  let openingRoute = false;
  const editRoute = async () => {
    const name = router.route.segments[1];
    if (!name || !poolController || openingRoute) return;
    openingRoute = true;
    router.replace(['providers']);
    try { await poolController.edit(name); }
    finally { openingRoute = false; }
  };
  const tabs = pageTabs(root.ownerDocument, signal, [
    { value: 'pool', label: POOL_TEXT.pool },
    ...(advancedMode && ctx.capabilities.extensions ? [{ value: 'market', label: S.marketTab }] : []),
  ], { onSelect: value => router.navigate(['providers'], value === 'pool' ? undefined : { view: value }) });
  intro.classList.add('provider-intro');
  intro.append(tabs.el);
  root.append(intro, pool, market);
  const show = () => {
    if (signal.aborted || router.route.segments[0] !== 'providers') return;
    const next = advancedMode && router.route.query.view === 'market' && ctx.capabilities.extensions ? 'market' : 'pool';
    if (current === next) {
      if (next === 'pool') void editRoute().catch(ctx.onError);
      return;
    }
    viewLife?.dispose();
    poolController = undefined;
    current = next;
    for (const [view, pane] of Object.entries(panes)) {
      pane.hidden = view !== next;
      pane.replaceChildren();
    }
    tabs.setValue(next);
    const lifecycle = viewLife = new Lifecycle(ctx.onError);
    const child = { ...ctx, root: panes[next], route: router.route, lifecycle, signal: lifecycle.signal };
    if (next === 'market') mountExtensionContent(child, 'provider');
    else {
      const load = async (): Promise<void> => {
        child.root.replaceChildren();
        try {
          const moduleEditor = advancedMode ? await createModuleEditor(child) : undefined;
          if (lifecycle.signal.aborted) return;
          const mounted = await mountConnectionPool(child, { moduleEditor });
          if (!lifecycle.signal.aborted) {
            poolController = mounted;
            await editRoute();
          }
        }
        catch (error) {
          if (!lifecycle.signal.aborted) child.root.replaceChildren(listProblem(root.ownerDocument, error instanceof Error ? error.message : String(error), COMMON.retry, load));
        }
      };
      void load();
    }
  };
  ctx.lifecycle.add(() => viewLife?.dispose());
  ctx.lifecycle.own(router.onChange(show));
  show();
}

export const providersFeature: FrameworkFeature = { route: 'providers', label: S.navLabel, icon: 'cpu', navGroup: S.navGroup, mount: mountProviders };
