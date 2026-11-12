/**
 * The Start page mounts the shared connection pool, the desktop pet preview and the colour scheme
 * controls. The pool owns connection state; pet state is polled through the World's public panel.
 */

import { actionProblem } from '../../base/ui/problem.ts';
import { invokePanel } from '../../base/api.ts';
import type { Page, PageContext } from '../../base/page.ts';
import { intro } from '../intro.ts';
import { revealWhenPainted } from '../frame-reveal.ts';
import { schemesCard } from '../schemes/index.ts';
import { mountConnectionPool } from '../connections/index.ts';
import { S } from './strings.ts';

const PET_PAGE = 'world:desktop-pet';

interface PetState { connected: boolean; onDesktop?: boolean; url: string | null }

/**
 * The preview's height: what is left down to the window's bottom edge, less the row of buttons under
 * it and a small margin, so the model card, the preview and its buttons fill the
 * window; it follows the window's height between these bounds.
 */
const PREVIEW_MIN = 180;
const PREVIEW_MAX = 560;
const PREVIEW_GAP = 20;

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function mount(ctx: PageContext): Promise<void> {
  const { ui, root, signal } = ctx;
  const opts = { signal };
  const problem = actionProblem(ui, root.ownerDocument, signal);
  root.classList.add('home');

  /* ---------- heading ---------- */
  const guide = ui.button(S.guide, { size: 'sm', onClick: () => { void invokePanel(PET_PAGE, 'pet', 'guide', [], opts).catch((err) => problem(guide, errText(err))); } });
  guide.title = S.guideHint;
  root.append(intro(ui, S.nav, { actions: [guide] }));

  /* ---------- model ---------- */
  const model = ui.sheet({ title: S.modelTitle });
  root.append(model.el);
  await mountConnectionPool({ ...ctx, root: model.body }, { compact: true });
  if (signal.aborted) return;

  /* ---------- pet ---------- */
  // whether the pet is on the desktop beside the title; the preview, sized so its buttons end just above
  // the window's bottom edge; the buttons under it
  const pet = ui.sheet({ title: S.petTitle });
  const petPill = ui.pill('—', 'off');
  pet.el.querySelector(':scope > h3')?.append(petPill);
  const preview = ui.h('iframe', 'home-petframe');
  const reveal = revealWhenPainted(preview, signal);
  preview.title = S.petTitle;
  const petLine = ui.rowbar();
  petLine.classList.add('home-petactions');
  const hidePet = ui.button(S.hidePet, { size: 'sm' });
  const showPet = ui.button(S.showPet, { size: 'sm' });
  const dress = ui.button(S.dress, { size: 'sm', variant: 'primary' });
  petLine.append(ui.h('span', 'grow'), hidePet, showPet, dress);
  pet.body.append(preview, petLine);
  root.append(pet.el);
  const fitPreview = () => {
    const top = preview.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    const below = petLine.getBoundingClientRect().bottom - preview.getBoundingClientRect().bottom;
    preview.style.setProperty('--fit', `${Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, root.clientHeight - top - below - PREVIEW_GAP))}px`);
  };
  // the preview lends the settings window's theme color to its light, as the dressing page does
  const lendAccent = () => {
    const origin = preview.dataset.src ? new URL(preview.dataset.src).origin : null;
    const accent = getComputedStyle(root.ownerDocument.documentElement).getPropertyValue('--accent').trim();
    const mode = root.ownerDocument.documentElement.dataset.colorMode === 'dark' ? 'dark' : 'light';
    if (origin) preview.contentWindow?.postMessage({ type: 'companion:appearance', mode, accent }, origin);
  };
  preview.addEventListener('load', lendAccent, opts);
  const themeWatch = new MutationObserver(lendAccent);
  themeWatch.observe(root.ownerDocument.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'data-theme-scheme', 'style'] });
  ctx.lifecycle.add(() => themeWatch.disconnect());
  const fit = new ResizeObserver(fitPreview);
  fit.observe(root);
  fit.observe(model.el);
  ctx.lifecycle.add(() => fit.disconnect());

  /* pet */
  let petState: PetState | null = null;
  const refreshPet = async () => {
    try {
      petState = await invokePanel<PetState>(PET_PAGE, 'pet', 'state', [], opts);
    } catch { petState = null; }
    const onDesktop = petState?.onDesktop === true;
    petPill.textContent = onDesktop ? S.petShown : S.petHidden;
    petPill.className = `pill ${onDesktop ? 'on' : 'off'}`;
    hidePet.disabled = !onDesktop;
    if (petState?.url && preview.dataset.src !== petState.url) {
      preview.dataset.src = petState.url;
      reveal.pend();
      preview.src = petState.url;
    }
  };
  const petCall = (method: string) => invokePanel(PET_PAGE, 'pet', method, [], opts).catch(() => null);
  showPet.addEventListener('click', async () => {
    // a hidden window comes back by opening it again
    await petCall('closeWindow');
    await petCall('openWindow');
    setTimeout(() => void refreshPet(), 1500);
  });
  hidePet.addEventListener('click', async () => {
    await petCall('hideWindow');
    setTimeout(() => void refreshPet(), 400);
  });
  dress.addEventListener('click', () => ctx.router.navigate(['dress']));

  /* ---------- color scheme ---------- */
  root.append(schemesCard(ctx, S.schemeTitle));

  await refreshPet();
  ctx.lifecycle.interval(() => { void refreshPet(); }, 2000);
}

export const homePage: Page = {
  route: 'home',
  label: S.nav,
  icon: 'play',
  mount,
};
