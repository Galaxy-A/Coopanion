/**
 * The Start page and provider page share one pool and one connection editor. Only the public
 * provider API and provider-owned panels are used here; the advanced host supplies module editors.
 */
import type { PageContext } from '../../base/page.ts';
import { get, post } from '../../base/api.ts';
import { LANGUAGE } from '../../base/language.ts';
import { dialogEnvironment } from '../../base/ui/index.ts';
import { icon, type ConsoleIconName } from '../../base/ui/icons.ts';
import { modalCard, openModal } from '../../../shared/ui/modal.ts';
import { plainRemote } from 'cortico-provider-coo/src/address.ts';
import {
  CHATGPT_MODULE, chatgptEntry, defaultRegion, locate, regionsOf, siteOf, vendorEntry, vendorName, vendorsFor,
  type Protocol, type Vendor,
} from 'cortico-provider-coo/src/vendors.ts';
import { accountRow, CHATGPT_TEXT, openInBrowser, signOutBeforeDelete } from '../chatgpt/index.ts';
import { chatgptState, signInChatGPT } from 'cortico-provider-coo/src/connect.ts';
import { consoleCall } from '../home/model.ts';
import {
  connectionPath, fetchModels, listConnections, normalizeUrl, probeConnection, protocolOf, readConnection, requestUrl,
  saveConnection, useConnection, type Connection, type Detail, type Entry, type HubState, type ListedModel, type Probe,
} from './model.ts';
import { S } from './strings.ts';
import { S as DETAIL_TEXT } from '../../advanced/features/providers/strings.ts';
import { pricingEditor } from '../../advanced/features/providers/pricing.ts';

type Context = Pick<PageContext, 'root' | 'ui' | 'signal' | 'lifecycle' | 'router'>;
export interface ModuleEditor {
  modules: readonly { id: string; title: string }[];
  open(options: { saved?: Detail; kind?: string; onSaved(name: string): Promise<void> }): Promise<void>;
}
const protocols: Array<{ value: Protocol; label: string }> = [
  { value: 'responses', label: 'OpenAI Responses' }, { value: 'chat', label: 'Chat Completions' },
  { value: 'anthropic', label: 'Anthropic Messages' }, { value: 'gemini', label: 'Gemini' },
];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const supported = (kind: string) => kind === 'coo' || kind === CHATGPT_MODULE;
const nameValid = (name: string) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name);
const uniqueName = (base: string, names: string[]) => {
  const used = new Set(names.map(name => name.toLowerCase()));
  let name = base, number = 2;
  while (used.has(name.toLowerCase())) name = `${base}-${number++}`;
  return name;
};

function tool(ctx: Context, label: string, glyph: ConsoleIconName, action: () => void): HTMLButtonElement {
  const button = ctx.ui.button('', { size: 'sm', onClick: action });
  button.classList.add('pool-icon');
  button.title = label; button.setAttribute('aria-label', label);
  button.append(icon(ctx.root.ownerDocument, glyph));
  return button;
}

function probeText(result: Probe): string {
  return result.ok
    ? `${S.testOk} · ${result.status === null ? '' : `HTTP ${result.status} · `}${S.elapsed(result.elapsedMs)}${result.model ? ` · ${result.model}` : ''}`
    : `${S.testFailed}${result.status === null ? '' : ` · HTTP ${result.status}`}: ${result.hint ?? result.error ?? ''}`;
}

/** A connection is saved before it is activated. Failed activation leaves the saved editor open. */
export async function openConnectionEditor(ctx: Context, options: {
  saved?: Detail; copy?: Detail; moduleEditor?: ModuleEditor; onSaved(name: string): Promise<void>;
}): Promise<void> {
  if (options.saved && !supported(options.saved.entry.kind)) {
    if (options.moduleEditor) await options.moduleEditor.open(options);
    else ctx.ui.toast(S.unsupported, 'bad');
    return;
  }
  const pool = await listConnections(ctx.signal);
  if (ctx.signal.aborted) return;
  const { ui } = ctx;
  const env = { ...dialogEnvironment(ui), signal: ctx.signal };
  const previousFocus = env.doc.activeElement as HTMLElement | null;
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const layer = openModal(env, () => { previousFocus?.focus(); resolveClosed(); });
  const { card, head, body } = modalCard(env, layer, options.saved ? S.edit : S.add);
  card.classList.add('pool-editor');
  const opts = { signal: layer.signal };
  head.append(tool(ctx, S.cancel, 'close', () => layer.close()));
  let saved = options.saved;
  const copied = options.copy;
  const credentialSource = () => saved ?? copied;
  let entry: Entry = structuredClone(credentialSource()?.entry ?? { kind: 'coo', baseUrl: '', options: { protocol: 'responses' }, spec: { model: '', thinking: false, maxTokens: 8192 } });
  const names = pool.providers.map(item => item.name);
  const { shown, more } = vendorsFor(LANGUAGE);
  const vendors = [...shown, ...more];
  let vendor: Vendor | undefined = entry.kind === CHATGPT_MODULE ? vendors.find(item => item.signIn) : undefined;
  let region = locate(entry.baseUrl)?.region ?? defaultRegion(LANGUAGE);
  let operation: AbortController | null = null;
  let busy = false;
  let submitted = false;
  let nameEdited = !!credentialSource();
  let listedModels: ListedModel[] = [];
  let selectedModule: string | undefined;
  const form = ui.h('form', 'pool-form');
  form.noValidate = true;
  const fields = ui.h('fieldset', 'pool-fields');
  form.append(fields); body.append(form);
  const feedback = ui.msgline();
  feedback.classList.add('pool-feedback');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  const feedbackError = (error: unknown) => { feedback.textContent = message(error); feedback.classList.add('bad'); };
  const clearFeedback = () => { feedback.textContent = ''; feedback.classList.remove('bad'); };
  const addField = (label: string, control: HTMLElement, parent: HTMLElement = fields) => {
    const box = ui.h('div', 'pool-field');
    control.setAttribute('aria-label', label);
    const error = ui.h('span', 'field-error');
    error.setAttribute('aria-live', 'polite');
    box.append(ui.field(label, control), error);
    parent.append(box);
    return { box, error };
  };
  const preset = ui.select({ options: [
    { value: '', label: S.custom },
    ...vendors.map(item => ({ value: item.id, label: vendorName(item, LANGUAGE) })),
    ...(options.moduleEditor?.modules ?? []).filter(item => !supported(item.id)).map(item => ({ value: `module:${item.id}`, label: item.title })),
  ] });
  const regionSelect = ui.select({ value: region, options: [{ value: 'cn', label: S.cn }, { value: 'intl', label: S.intl }] });
  const sourceRow = ui.h('div', 'pool-source');
  fields.append(sourceRow);
  addField(S.preset, preset, sourceRow);
  const regionField = addField(S.region, regionSelect, sourceRow);
  sourceRow.hidden = !!credentialSource();
  regionField.box.hidden = true;
  const name = ui.input({ value: saved?.name ?? uniqueName(copied ? `${copied.name.slice(0, 50)}-Copy` : 'custom', names) });
  name.autocomplete = 'off'; name.spellcheck = false;
  const nameField = addField(S.name, name);
  nameField.box.append(ui.msgline(S.nameHint));
  const protocol = ui.segmented(protocols, { value: protocolOf(entry), size: 'sm', onSelect: value => {
    entry.options = { ...entry.options, protocol: value };
    key.value = ''; listedModels = []; renderModels(); changed();
  } });
  protocol.el.setAttribute('aria-label', S.protocol);
  protocol.el.setAttribute('role', 'group');
  const protocolField = ui.h('div', 'pool-field');
  protocolField.append(ui.h('span', 'fieldlabel', S.protocol), protocol.el);
  fields.append(protocolField);
  const url = ui.input({ value: entry.baseUrl, placeholder: 'https://api.example.com/v1' });
  url.type = 'url'; url.autocomplete = 'off'; url.spellcheck = false;
  const urlField = addField(S.url, url);
  const pathNote = ui.h('div', 'pool-request mono');
  pathNote.setAttribute('aria-live', 'polite');
  urlField.box.append(pathNote);
  const addressNotice = ui.msgline(S.changedAddress);
  addressNotice.classList.add('pool-address-notice');
  fields.append(addressNotice);
  const key = ui.input({ type: 'password', placeholder: credentialSource() && credentialSource()?.secretConfigured !== 'none' ? S.keepKey : 'sk-...' });
  key.autocomplete = 'new-password'; key.spellcheck = false;
  const keyField = addField(S.key, key);
  const showKey = tool(ctx, S.showKey, 'eye', () => {
    const visible = key.type === 'password';
    key.type = visible ? 'text' : 'password';
    showKey.replaceChildren(icon(env.doc, visible ? 'eye-off' : 'eye'));
    showKey.title = visible ? S.hideKey : S.showKey;
    showKey.setAttribute('aria-label', showKey.title);
  });
  const keyLine = ui.h('div', 'pool-key');
  key.before(keyLine); keyLine.append(key, showKey);
  const noAuth = ui.checkbox(S.noAuth, { checked: !!credentialSource() && !entry.secret });
  keyField.box.append(noAuth.el);
  const keyLink = ui.h('a', 'home-link', S.getKey);
  keyLink.target = '_blank'; keyLink.rel = 'noopener noreferrer'; keyLink.hidden = true;
  keyField.box.append(keyLink);
  const model = ui.input({ value: entry.spec?.model ?? '', placeholder: S.manualModel });
  model.autocomplete = 'off'; model.spellcheck = false;
  const modelField = addField(S.model, model);
  const modelTools = ui.rowbar();
  const fetch = ui.button(S.fetchModels, { size: 'sm', onClick: () => void run('models') });
  fetch.prepend(icon(env.doc, 'refresh'));
  const modelCount = ui.msgline();
  modelTools.append(fetch, modelCount);
  const modelSearch = ui.input({ placeholder: S.modelSearch });
  modelSearch.type = 'search'; modelSearch.setAttribute('aria-label', S.modelSearch);
  const modelResults = ui.h('div', 'pool-model-results');
  modelResults.setAttribute('role', 'listbox'); modelResults.setAttribute('aria-label', S.model);
  const modelCatalog = ui.h('div', 'pool-model-catalog'); modelCatalog.hidden = true;
  modelCatalog.append(modelSearch, modelResults);
  modelField.box.append(modelTools, modelCatalog);
  const extra = ui.h('details', 'pool-extra');
  extra.append(ui.h('summary', null, S.more));
  const extraFields = ui.h('div', 'pool-extra-fields'); extra.append(extraFields); fields.append(extra);
  const effort = ui.select({ options: [
    { value: 'off', label: S.off }, { value: 'low', label: S.low }, { value: 'high', label: S.high }, { value: 'max', label: S.max },
  ], value: !entry.spec?.thinking ? 'off' : entry.spec.reasoningEffort ?? 'high' });
  // An extension or an older config can carry a valid effort outside the four Coo presets.
  if (entry.spec?.thinking && entry.spec.reasoningEffort && ![...effort.options].some(option => option.value === entry.spec?.reasoningEffort)) {
    const option = ui.h('option', null, entry.spec.reasoningEffort); option.value = entry.spec.reasoningEffort; effort.append(option); effort.value = option.value;
  }
  addField(S.reasoning, effort, extraFields);
  const images = ui.checkbox(S.images, { checked: entry.multimodal === true });
  extraFields.append(images.el);
  const context = ui.input({ type: 'number', value: String(entry.spec?.contextWindow ?? '') });
  const output = ui.input({ type: 'number', value: String(entry.spec?.maxTokens ?? '') });
  context.min = output.min = '1'; context.step = output.step = '1';
  addField(S.context, context, extraFields); const outputField = addField(S.maxTokens, output, extraFields);
  const temperature = ui.input({ type: 'number', value: String(entry.spec?.temperature ?? '') });
  temperature.min = '0'; temperature.max = '2'; temperature.step = 'any';
  const temperatureField = addField(DETAIL_TEXT.temperature, temperature, extraFields);
  const pricing = ui.h('details', 'pool-pricing');
  pricing.append(ui.h('summary', null, DETAIL_TEXT.pricing));
  const pricingFields = ui.h('div');
  pricing.append(pricingFields); extra.append(pricing);
  let prices: ReturnType<typeof pricingEditor>;
  let pricingEdited = false;
  const account = ui.h('div', 'pool-account');
  fields.append(account);
  const actions = ui.rowbar(); actions.classList.add('pool-editor-actions');
  const test = ui.button(S.test, { onClick: () => void run('test') }); test.prepend(icon(env.doc, 'activity'));
  const cancel = ui.button(S.cancel, { onClick: () => layer.close() });
  const save = ui.button(S.save, { onClick: () => void run('save') });
  const saveUse = ui.button(S.saveUse, { variant: 'primary', onClick: () => void run('use') });
  actions.append(test, ui.h('span', 'grow'), cancel, save, saveUse);
  form.append(feedback);
  card.append(actions);
  const addressChanged = () => {
    const source = credentialSource();
    return !!source && (normalizeUrl(url.value, protocol.value as Protocol) !== source.entry.baseUrl.replace(/\/+$/, '')
      || protocol.value !== protocolOf(source.entry));
  };
  const syncKey = () => {
    key.disabled = noAuth.checked; showKey.disabled = noAuth.checked;
    if (noAuth.checked) key.value = '';
  };
  function readEntry(): Entry {
    const current = structuredClone(entry);
    current.baseUrl = normalizeUrl(url.value, protocol.value as Protocol);
    current.options = { ...current.options, ...(current.kind === 'coo' ? { protocol: protocol.value } : {}) };
    const spec = current.spec ??= { model: '', thinking: false };
    spec.model = model.value.trim(); spec.thinking = effort.value !== 'off';
    if (spec.thinking && effort.value) spec.reasoningEffort = effort.value; else delete spec.reasoningEffort;
    if (context.value) spec.contextWindow = Number(context.value); else delete spec.contextWindow;
    if (output.value) spec.maxTokens = Number(output.value); else delete spec.maxTokens;
    if (temperature.value) spec.temperature = Number(temperature.value); else delete spec.temperature;
    current.multimodal = images.checked;
    if (noAuth.checked) delete current.secret;
    // A changed address never inherits the old environment variable or its credential.
    else if (addressChanged()) delete current.secret;
    return current;
  }
  function validate(show = submitted, requireModel = true): boolean {
    const problems = new Map<HTMLElement, { error: HTMLElement; text: string }>();
    const add = (control: HTMLElement, error: HTMLElement, text: string) => problems.set(control, { error, text });
    const value = name.value.trim();
    if (value !== saved?.name && !nameValid(value)) add(name, nameField.error, S.nameHint);
    else if (names.some(existing => existing.toLowerCase() === value.toLowerCase() && existing !== saved?.name)) add(name, nameField.error, S.duplicate);
    let addressValid = true;
    try {
      const raw = url.value.trim(), address = new URL(normalizeUrl(raw, protocol.value as Protocol));
      if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password || raw.includes('?') || raw.includes('#')) throw new Error();
      if (plainRemote(address.href)) add(url, urlField.error, S.httpsOnly);
    } catch { addressValid = false; add(url, urlField.error, S.invalidUrl); }
    if (entry.kind !== CHATGPT_MODULE && !noAuth.checked && !key.value.trim() && (!credentialSource() || credentialSource()?.secretConfigured === 'none' || addressChanged()))
      add(key, keyField.error, addressChanged() ? S.changedAddress : S.keyRequired);
    if (requireModel && !model.value.trim()) add(model, modelField.error, S.modelRequired);
    const positive = (input: HTMLInputElement) => !input.value || Number.isInteger(Number(input.value)) && Number(input.value) > 0;
    if (!positive(context) || !positive(output) || context.value && output.value && Number(context.value) <= Number(output.value))
      add(output, outputField.error, S.invalidNumber);
    if (temperature.validity.badInput || temperature.value && (!Number.isFinite(Number(temperature.value)) || Number(temperature.value) < 0 || Number(temperature.value) > 2))
      add(temperature, temperatureField.error, DETAIL_TEXT.invalidNumber);
    const pricingValid = prices.validate();
    for (const [control, error] of [[name, nameField.error], [url, urlField.error], [key, keyField.error], [model, modelField.error], [output, outputField.error], [temperature, temperatureField.error]] as const) {
      const issue = problems.get(control);
      error.textContent = show ? issue?.text ?? '' : '';
      control.setAttribute('aria-invalid', String(show && !!issue));
    }
    save.disabled = saveUse.disabled = busy || problems.size > 0 || !pricingValid;
    test.disabled = busy || problems.size > 0 || !pricingValid || entry.kind === CHATGPT_MODULE && !saved;
    fetch.disabled = busy || !addressValid || !!problems.get(url) || !!problems.get(key) || entry.kind !== 'coo';
    return problems.size === 0 && pricingValid;
  }
  function changed() {
    submitted = true; clearFeedback(); addressNotice.hidden = !addressChanged();
    pathNote.textContent = entry.kind === CHATGPT_MODULE || !url.value.trim() ? '' : `${S.request}: ${requestUrl(normalizeUrl(url.value, protocol.value as Protocol), protocol.value as Protocol)}`;
    syncKey();
    validate();
  }
  function renderModels() {
    const query = modelSearch.value.trim().toLowerCase();
    modelResults.replaceChildren();
    const combined = new Map<string, ListedModel>(listedModels.map(item => [item.id, item]));
    if (vendor) for (const id of [vendor.model, ...(vendor.models ?? [])]) if (!combined.has(id)) combined.set(id, { id });
    for (const item of combined.values()) {
      if (query && !`${item.id} ${item.displayName ?? ''}`.toLowerCase().includes(query)) continue;
      const button = ui.h('button', 'pool-model-option');
      button.type = 'button'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(item.id === model.value));
      button.append(ui.h('span', null, item.displayName && item.displayName !== item.id ? `${item.displayName} · ${item.id}` : item.id));
      if (item.id === model.value) button.append(icon(env.doc, 'check'));
      button.addEventListener('click', () => {
        model.value = item.id;
        if (item.contextWindow) context.value = String(item.contextWindow);
        if (item.maxOutputTokens) output.value = String(Math.min(Number(output.value) || item.maxOutputTokens, item.maxOutputTokens));
        if (item.inputImages !== undefined) images.setChecked(item.inputImages);
        else if (vendor) images.setChecked((vendor.vision ?? []).includes(item.id));
        changed(); renderModels();
      }, opts);
      modelResults.append(button);
    }
    modelCatalog.hidden = combined.size === 0;
  }
  function populate() {
    url.value = entry.baseUrl; model.value = entry.spec?.model ?? '';
    protocol.setValue(protocolOf(entry)); images.setChecked(entry.multimodal === true);
    effort.value = !entry.spec?.thinking ? 'off' : entry.spec.reasoningEffort ?? 'high';
    context.value = String(entry.spec?.contextWindow ?? '');
    output.value = String(entry.spec?.maxTokens ?? '');
    temperature.value = String(entry.spec?.temperature ?? '');
    pricingEdited = false;
    prices = pricingEditor(ui, entry.pricing ?? [], credentialSource()?.quotes ?? [], value => {
      if (pricingEdited) entry.pricing = value as Entry['pricing'];
    });
    pricingFields.replaceChildren(prices.body);
    key.value = ''; key.type = 'password'; showKey.replaceChildren(icon(env.doc, 'eye')); showKey.title = S.showKey; showKey.setAttribute('aria-label', S.showKey);
    syncKey();
    const chatgpt = entry.kind === CHATGPT_MODULE;
    protocolField.hidden = urlField.box.hidden = keyField.box.hidden = modelTools.hidden = chatgpt;
    account.hidden = !chatgpt;
    account.replaceChildren(...(chatgpt ? [saved ? accountRow(ui, saved.name, layer.signal) : ui.msgline(S.saveAccount), ui.msgline(CHATGPT_TEXT.quota)] : []));
    regionField.box.hidden = !vendor || !regionsOf(vendor).length;
    regionSelect.value = region;
    keyLink.hidden = !vendor || chatgpt;
    if (vendor) keyLink.href = siteOf(vendor, region).keyUrl;
    listedModels = []; modelCount.textContent = ''; modelSearch.value = '';
    renderModels(); submitted = false; clearFeedback(); addressNotice.hidden = !addressChanged();
    pathNote.textContent = chatgpt || !url.value ? '' : `${S.request}: ${requestUrl(url.value, protocol.value as Protocol)}`;
    validate(false);
  }
  preset.addEventListener('change', () => {
    if (preset.value.startsWith('module:')) {
      selectedModule = preset.value.slice('module:'.length);
      layer.close();
      return;
    }
    vendor = vendors.find(item => item.id === preset.value);
    region = defaultRegion(LANGUAGE);
    entry = vendor?.signIn ? chatgptEntry() : vendor ? vendorEntry(vendor, vendor.model, region)
      : { kind: 'coo', baseUrl: '', options: { protocol: 'responses' }, spec: { model: '', thinking: false, maxTokens: 8192 } };
    // Typed keys get the endpoint's own variable from Core, including when using a preset.
    delete entry.secret;
    noAuth.setChecked(false);
    if (!nameEdited) name.value = uniqueName(vendor?.id ?? 'custom', names);
    populate();
  }, opts);
  regionSelect.addEventListener('change', () => {
    region = regionSelect.value as typeof region;
    if (vendor) { entry = vendorEntry(vendor, vendor.model, region); delete entry.secret; populate(); }
  }, opts);
  name.addEventListener('input', () => { nameEdited = true; changed(); }, opts);
  url.addEventListener('input', () => { listedModels = []; renderModels(); changed(); }, opts);
  key.addEventListener('input', changed, opts);
  noAuth.input.addEventListener('change', changed, opts);
  model.addEventListener('input', () => { changed(); renderModels(); }, opts);
  for (const input of [effort, context, output, temperature, images.input]) input.addEventListener('change', changed, opts);
  const pricingChanged = () => { pricingEdited = true; changed(); };
  pricingFields.addEventListener('input', pricingChanged, opts);
  pricingFields.addEventListener('change', pricingChanged, opts);
  modelSearch.addEventListener('input', renderModels, opts);
  form.addEventListener('submit', event => { event.preventDefault(); if (!save.disabled) void run('save'); }, opts);
  async function run(action: 'models' | 'test' | 'save' | 'use') {
    if (busy) return;
    submitted = true;
    if (action !== 'models' && !validate()) return;
    if (action === 'models') {
      validate(true, false);
      if (fetch.disabled) return;
    }
    const snapshot = readEntry();
    const secretValue = key.value.trim();
    operation = new AbortController();
    const signal = AbortSignal.any([layer.signal, operation.signal]);
    busy = true; fields.disabled = true; save.disabled = saveUse.disabled = test.disabled = true;
    clearFeedback(); feedback.textContent = action === 'models' ? S.fetching : action === 'test' ? S.testing : S.saving;
    try {
      if (action === 'models') {
        const result = await fetchModels(snapshot, secretValue, noAuth.checked ? undefined : credentialSource()?.name, signal);
        if (signal.aborted) return;
        listedModels = result.models; modelCount.textContent = S.modelCount(listedModels.length);
        feedback.textContent = listedModels.length ? '' : S.noModels;
        renderModels();
      } else if (action === 'test') {
        // A unique identity avoids resolving another saved endpoint's credential for a new draft.
        const identity = credentialSource()?.name ?? `probe-${crypto.randomUUID()}`;
        const result = await probeConnection(identity, signal, { entry: snapshot, ...(secretValue ? { secretValue } : {}) });
        if (!signal.aborted) { feedback.textContent = probeText(result); feedback.classList.toggle('bad', !result.ok); }
      } else {
        const result = await saveConnection(name.value.trim(), snapshot, secretValue, saved, signal, copied ? { name: copied.name, revision: copied.revision } : undefined);
        saved = result; entry = structuredClone(result.entry); key.value = ''; names.push(result.name);
        if (signal.aborted) return;
        await options.onSaved(result.name);
        if (action === 'use') {
          try {
            if (entry.kind === CHATGPT_MODULE) {
              feedback.textContent = CHATGPT_TEXT.waiting;
              const call = consoleCall(signal);
              const state = await chatgptState(call, result.name);
              const auth = state.signedIn ? state : await signInChatGPT(call, result.name, openInBrowser, { signal });
              if (!auth.signedIn) throw new Error(auth.reason ?? S.needsSetup);
            }
            await useConnection(result.name, signal);
            await options.onSaved(result.name);
          } catch (error) { populate(); feedbackError(`${S.savedNotStarted} ${message(error)}`); return; }
        }
        ui.toast(action === 'use' ? S.started : S.saved, 'ok'); layer.close();
      }
    } catch (error) { if (!signal.aborted) feedbackError(error); }
    finally { busy = false; fields.disabled = false; operation = null; syncKey(); validate(submitted); }
  }
  layer.signal.addEventListener('abort', () => { key.value = ''; operation?.abort(); }, { once: true });
  populate();
  name.focus();
  await closed;
  if (selectedModule && !ctx.signal.aborted)
    await options.moduleEditor?.open({ kind: selectedModule, onSaved: options.onSaved });
}

export async function mountConnectionPool(ctx: Context, options: { compact?: boolean; moduleEditor?: ModuleEditor } = {}): Promise<{ refresh(): Promise<void>; edit(name: string): Promise<void> }> {
  const { ui, root, signal } = ctx;
  const box = ui.h('div', `model-pool${options.compact ? ' is-compact' : ''}`);
  const toolbar = ui.rowbar(); toolbar.classList.add('pool-toolbar');
  const search = ui.input({ placeholder: S.search }); search.type = 'search'; search.setAttribute('aria-label', S.search);
  const add = ui.button(S.add, { variant: 'primary', onClick: () => void openEditor() }); add.prepend(icon(root.ownerDocument, 'cpu'));
  const reload = tool(ctx, S.refresh, 'refresh', () => void refresh().catch(showError));
  toolbar.append(search, ui.h('span', 'grow'), reload, add);
  const current = ui.h('div', 'pool-current'); current.setAttribute('aria-live', 'polite');
  const feedback = ui.msgline(); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
  const list = ui.h('div', 'pool-list');
  box.append(toolbar, current, list, feedback); root.append(box);
  let state: HubState;
  let paused = true;
  let fetching = false;
  let mutation = false;
  let modalOpen = false;
  let renderedState = '';
  const results = new Map<string, { revision: string; text: string; ok: boolean }>();
  const showError = (error: unknown) => { if (!signal.aborted) { feedback.textContent = message(error); feedback.classList.add('bad'); } };
  async function openEditor(name?: string, copy = false) {
    if (modalOpen) return;
    modalOpen = true;
    try {
      const detail = name ? await readConnection(name, signal) : undefined;
      await openConnectionEditor(ctx, { ...(detail ? copy ? { copy: detail } : { saved: detail } : {}), moduleEditor: options.moduleEditor, onSaved: async () => refresh() });
    }
    catch (error) { showError(error); }
    finally { modalOpen = false; }
  }
  async function remove(item: Connection) {
    if (mutation) return;
    mutation = true; paint();
    try {
      const current = await readConnection(item.name, signal);
      if (current.references.length) throw new Error(DETAIL_TEXT.referenced + current.references.join(', '));
      if (!(await ui.confirm({ title: DETAIL_TEXT.remove, body: DETAIL_TEXT.deleteConfirm, danger: true }))) return;
      if (item.module === CHATGPT_MODULE && current.revision === item.revision) await signOutBeforeDelete(item.name, signal);
      await post(connectionPath(item.name) + '/delete', { expectedRevision: item.revision }, { signal });
      await refresh();
    } catch (error) { showError(error); }
    finally { mutation = false; paint(); }
  }
  function paint() {
    if (!state || signal.aborted) return;
    const selected = state.providers.find(item => item.name === state.active);
    current.replaceChildren(
      ui.h('span', 'pool-current-label', S.current),
      ui.h('strong', null, selected ? `${selected.name}${selected.model ? ` · ${selected.model}` : ''}` : S.notConnected),
      ui.pill(selected?.readiness.state === 'ready' ? paused ? S.paused : S.running : S.needsSetup, selected?.readiness.state === 'ready' && !paused ? 'on' : 'off'),
    );
    const query = search.value.trim().toLowerCase();
    const providers = [...state.providers].sort((a, b) => Number(b.name === state.active) - Number(a.name === state.active))
      .filter(item => !query || `${item.name} ${item.baseUrl} ${item.model ?? ''} ${item.moduleTitle}`.toLowerCase().includes(query));
    list.replaceChildren();
    if (!providers.length) { list.append(ui.h('p', 'pool-empty', state.providers.length ? S.noMatches : S.empty)); return; }
    for (const item of providers) {
      const row = ui.h('article', 'pool-provider'); row.dataset.provider = item.name;
      row.classList.toggle('is-current', item.name === state.active);
      const mark = ui.h('span', 'pool-provider-mark'); mark.append(icon(root.ownerDocument, item.module === CHATGPT_MODULE ? 'message' : 'cpu'));
      const info = ui.h('div', 'pool-provider-info');
      const title = ui.h('div', 'pool-provider-title'); title.append(ui.h('strong', null, item.name));
      if (item.name === state.active) title.append(ui.pill(S.current, 'on'));
      info.append(title, ui.h('div', 'pool-provider-model', item.model ?? S.modelRequired), ui.h('div', 'pool-provider-url', item.baseUrl));
      const ready = item.readiness.state === 'ready';
      const readiness = ui.h('div', 'pool-provider-readiness', ready ? S.ready : item.readiness.reason ?? S.needsSetup);
      readiness.dataset.tone = ready ? 'ready' : 'error';
      info.append(readiness);
      const result = results.get(item.name);
      if (result?.revision === item.revision) { const line = ui.msgline(result.text, !result.ok); line.classList.add('pool-probe'); info.append(line); }
      const actions = ui.h('div', 'pool-provider-actions');
      const test = tool(ctx, S.test, 'activity', () => void run(item, 'test'));
      const edit = tool(ctx, S.edit, 'pencil', () => void openEditor(item.name));
      const erase = tool(ctx, DETAIL_TEXT.remove, 'trash', () => void remove(item));
      erase.disabled = mutation;
      const use = ui.button(S.use, { size: 'sm', variant: 'primary', onClick: () => void run(item, 'use') }); use.prepend(icon(root.ownerDocument, 'play'));
      const editable = supported(item.module) || !!options.moduleEditor;
      use.disabled = mutation || !ready && item.module !== CHATGPT_MODULE; test.disabled = mutation || !ready; edit.disabled = mutation || !editable;
      edit.title = editable ? S.edit : S.unsupported;
      if (item.name === state.active && !paused) use.hidden = true;
      actions.append(test, edit);
      if (item.module === 'coo') {
        const copy = tool(ctx, DETAIL_TEXT.duplicate, 'copy', () => void openEditor(item.name, true));
        copy.disabled = mutation; actions.append(copy);
      }
      actions.append(erase, use); row.append(mark, info, actions); list.append(row);
    }
  }
  async function run(item: Connection, action: 'test' | 'use') {
    if (mutation) return;
    mutation = true; feedback.classList.remove('bad'); feedback.textContent = action === 'test' ? S.testing : S.using; paint();
    try {
      if (action === 'test') {
        const result = await probeConnection(item.name, signal);
        results.set(item.name, { revision: item.revision, text: probeText(result), ok: result.ok }); feedback.textContent = '';
      } else {
        if (item.module === CHATGPT_MODULE && item.readiness.state !== 'ready') {
          const auth = await signInChatGPT(consoleCall(signal), item.name, openInBrowser, { signal });
          if (!auth.signedIn) throw new Error(auth.reason ?? S.needsSetup);
        }
        await useConnection(item.name, signal); feedback.textContent = S.started; await refresh();
      }
    } catch (error) { showError(error); }
    finally { mutation = false; paint(); }
  }
  async function refresh() {
    if (fetching || signal.aborted) return;
    fetching = true;
    try {
      const [pool, status] = await Promise.all([listConnections(signal), get<{ loop: { paused: boolean } }>('/api/status', { signal })]);
      if (signal.aborted) return;
      const next = JSON.stringify([pool, status.loop.paused]);
      state = pool; paused = status.loop.paused;
      if (next !== renderedState) { renderedState = next; paint(); }
    } finally { fetching = false; }
  }
  search.addEventListener('input', paint, { signal });
  await refresh();
  ctx.lifecycle.interval(() => { if (!mutation && !modalOpen) void refresh().catch(showError); }, 5000);
  return { refresh, edit: name => openEditor(name) };
}
