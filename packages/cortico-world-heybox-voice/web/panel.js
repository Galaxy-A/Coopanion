/** @param {import('cortico/web/shared/client-panel.ts').WebUiPanelContext} ctx */
async function mount(ctx) {
  const { ui, root, signal } = ctx;
  let state = await ctx.invoke('state');
  if (signal.aborted) return;
  const s = state.labels;
  let busy = false, polling = false, speaking = false, pendingMethod = '', stateVersion = 0;
  root.classList.add('heybox-bridge');
  ctx.own({ dispose: () => root.classList.remove('heybox-bridge') });
  ctx.notifyOnUnmount?.('endCheck');
  const message = ui.msgline();
  const status = ui.h('strong', 'heybox-status');
  const actions = ui.actions();
  const configure = ui.button(s.configure, { onClick: () => void action('configure', [], () => { setup.open = true; }) });
  const receive = ui.button(s.checkReceive, { onClick: () => void action('checkReceive') });
  const start = ui.button(s.startBridge, { variant: 'primary', onClick: () => void action('startBridge') });
  const stop = ui.button(s.stopBridge, { onClick: () => void action('stopBridge') });
  actions.append(configure, receive, start, stop);
  const checklist = ui.h('dl', 'heybox-checklist');
  const rows = Object.fromEntries(['service', 'device', 'model', 'capture', 'sendCheck', 'receiveCheck'].map((key) => {
    const value = ui.h('dd');
    checklist.append(ui.h('dt', null, key === 'device' ? s.sendRoute : s[key]), value);
    return [key, value];
  }));
  const setup = ui.h('details', 'heybox-setup');
  setup.open = !state.setup.sendConfirmedAt || !state.setup.receiveAt;
  setup.append(ui.h('summary', null, s.configure), ui.h('p', null, s.setupHint));
  const serviceHint = ui.h('p', null, s.serviceHint);
  const installHint = ui.h('p', null, s.installHint);
  const install = ui.button(s.install, { onClick: () => void action('install') });
  const restart = ui.msgline(s.restartHint);
  const download = ui.button(s.downloadModel, { onClick: () => void action('downloadModel') });
  const progress = ui.msgline();
  const microphoneHint = ui.h('p', null, s.microphoneHint);
  const sendMode = ui.h('select', 'field');
  sendMode.setAttribute('aria-label', s.sendMode);
  const sendModeLabel = ui.h('label', null, s.sendMode);
  sendModeLabel.append(sendMode);
  const microphone = ui.h('select', 'field');
  microphone.setAttribute('aria-label', s.microphoneDevice);
  const microphoneLabel = ui.h('label', null, s.microphoneDevice);
  microphoneLabel.append(microphone);
  const micSection = ui.h('section', 'heybox-microphone');
  const micStatus = ui.msgline();
  const micError = ui.msgline();
  const micLocation = ui.msgline();
  const micRestart = ui.msgline(s.micRebootHint);
  const micActions = ui.actions();
  const installMic = ui.button(s.installMicrophone, { onClick: () => void action('installMicrophone') });
  const configureMic = ui.button(s.configureMicrophone, { onClick: () => void action('configureMicrophone') });
  const openMic = ui.button(s.openMicrophoneConfigurator, { onClick: () => void action('openMicrophoneConfigurator') });
  const removeMic = ui.button(s.removeMicrophone, { onClick: () => void action('removeMicrophone') });
  micActions.append(installMic, configureMic, openMic, removeMic);
  micSection.append(ui.h('strong', null, s.freeComponent), microphoneLabel, micStatus, micError, micLocation, micRestart,
    ui.h('p', null, s.micSetupHint), micActions, ui.h('p', null, s.micInstallHint), ui.h('p', null, s.micPrivacyHint));
  const output = ui.h('select', 'field');
  output.setAttribute('aria-label', s.device);
  const outputLabel = ui.h('label', null, s.device);
  outputLabel.append(output);
  const process = ui.h('select', 'field');
  process.setAttribute('aria-label', s.process);
  const processLabel = ui.h('label', null, s.process);
  processLabel.append(process);
  const confirm = ui.button(s.confirmSend, { onClick: () => void action('confirmSend') });
  setup.append(serviceHint, sendModeLabel, micSection, installHint, install, restart,
    download, progress, microphoneHint, outputLabel, processLabel);
  const transcript = ui.h('p', 'heybox-transcript');
  const meter = ui.h('meter');
  meter.min = -100; meter.max = 0;
  meter.setAttribute('aria-label', s.threshold);
  const reception = ui.h('section', 'heybox-reception');
  reception.append(ui.h('strong', null, s.receiveCheck), meter, transcript);
  let keywordDirty = false;
  const keyword = ui.h('input', 'field');
  keyword.type = 'text';
  keyword.value = state.config.addressKeyword || '';
  keyword.setAttribute('aria-label', s.addressKeyword);
  const keywordLabel = ui.h('label', null, s.addressKeyword);
  keywordLabel.append(keyword);
  const keywordStatus = ui.msgline();
  const keywordActions = ui.actions();
  const saveKeyword = ui.button(s.saveKeyword, { onClick: () => void save('addressKeyword', keyword.value) });
  keywordActions.append(saveKeyword);
  reception.append(keywordLabel, ui.h('p', null, s.keywordHint), keywordActions, keywordStatus);
  const text = ui.h('textarea', 'field');
  text.rows = 2; text.maxLength = 2000; text.value = s.testPhrase;
  text.setAttribute('aria-label', s.text);
  const textLabel = ui.h('label', null, s.text);
  textLabel.append(text);
  const speechActions = ui.actions();
  const send = ui.button(s.send, { onClick: () => void speak() });
  const hush = ui.button(s.stop, { onClick: () => void action('stop') });
  speechActions.append(send, confirm, hush);
  root.replaceChildren(status, actions, message, reception, checklist, setup, textLabel, speechActions);

  function setRow(key, ready, detail = '') {
    rows[key].textContent = `${ready ? s.ready : s.pending}${detail ? ` · ${detail}` : ''}`;
    rows[key].classList.toggle('heybox-ready', ready);
  }
  function options(select, choices, selected) {
    const signature = JSON.stringify(choices);
    if (select.dataset.choices !== signature) {
      select.replaceChildren(...choices.map(([value, label, disabled]) => {
        const item = ui.h('option', null, label);
        item.value = String(value); item.disabled = !!disabled;
        return item;
      }));
      select.dataset.choices = signature;
    }
    select.value = String(selected);
  }
  function render() {
    const a = state.setup, r = state.receive, m = state.microphoneSetup;
    const viaMicrophone = state.config.sendMode === 'microphone';
    status.textContent = state.bridging ? s.running
      : pendingMethod === 'checkReceive' || r.mode === 'check' && ['starting', 'running'].includes(r.phase)
        ? s.checking : s.bridgeStopped;
    setRow('service', state.health.ready, state.health.state);
    const microphoneName = m.devices.find((device) => device.id === state.config.microphoneEndpoint)?.name || '';
    setRow('device', state.outputReady && !state.deviceError,
      state.deviceError || (viaMicrophone ? microphoneName : state.config.outputDevice));
    setRow('model', r.model.phase === 'ready', r.model.detail || '');
    setRow('capture', a.supported && state.processes.length > 0, state.processError || (r.capture ? `PID ${r.capture.pid} · ${r.capture.chunks}` : ''));
    setRow('sendCheck', !!a.sendConfirmedAt);
    setRow('receiveCheck', !!a.receiveAt);
    serviceHint.hidden = state.health.ready;
    install.hidden = viaMicrophone || a.driverReady || a.restartRequired;
    installHint.hidden = install.hidden;
    install.disabled = busy || ['downloading', 'installing'].includes(a.phase);
    restart.hidden = viaMicrophone || !a.restartRequired;
    options(sendMode, [['microphone', s.microphoneMode, false], ['device', s.deviceMode, false]], state.config.sendMode || 'device');
    sendMode.disabled = busy || speaking || state.bridging;
    micSection.hidden = !viaMicrophone;
    microphoneHint.hidden = viaMicrophone;
    outputLabel.hidden = viaMicrophone;
    const microphones = [['', s.chooseMicrophone, false], ...m.devices.map((device) =>
      [device.id, `${device.name}${device.isDefault ? ` · ${s.defaultDevice}` : ''}`, false])];
    if (state.config.microphoneEndpoint && !m.devices.some((device) => device.id === state.config.microphoneEndpoint)) {
      microphones.push([state.config.microphoneEndpoint, s.unavailable, true]);
    }
    options(microphone, microphones, state.config.microphoneEndpoint || '');
    microphone.disabled = busy || speaking || state.bridging;
    const micBusy = ['downloading', 'installing', 'configuring', 'removing'].includes(m.phase);
    const micConfigured = m.pluginInstalled && m.configuredEndpoint === state.config.microphoneEndpoint;
    micStatus.textContent = !m.installed ? s.micMissing : !micConfigured
      ? s.pending : state.microphone.ready ? s.micActive : s.micWaiting;
    micError.textContent = m.error || (m.phase === 'downloading' ? s.download : '');
    micError.hidden = !micError.textContent;
    micError.classList.toggle('bad', !!m.error);
    micLocation.textContent = m.installed && m.installDir
      ? `${s.detectedInstallLocation}: ${m.installDir} · ${s.configLocation}: ${m.configDir}`
      : `${s.installerLocation}: ${m.installerDir}`;
    micLocation.hidden = !micLocation.textContent;
    micRestart.hidden = !m.restartRequired;
    installMic.hidden = m.installed;
    installMic.disabled = busy || micBusy || state.bridging;
    configureMic.disabled = busy || speaking || micBusy || state.bridging || !m.installed || !state.config.microphoneEndpoint;
    openMic.hidden = !m.installed;
    openMic.disabled = busy || speaking || micBusy || state.bridging;
    removeMic.hidden = !m.configuredEndpoint;
    removeMic.disabled = busy || speaking || micBusy || state.bridging;
    download.hidden = r.model.phase === 'ready';
    download.disabled = busy || r.model.phase === 'working';
    progress.textContent = a.error || (['downloading', 'installing'].includes(a.phase) ? s.download : '')
      || (r.model.phase === 'working' ? `${s.download} · ${Math.round(r.model.done / (r.model.total || 1) * 100)}%` : '');
    progress.hidden = !progress.textContent;
    progress.classList.toggle('bad', !!a.error);
    const outputs = state.devices.filter((d) => d.direction === 'output');
    const choices = [['', s.choose, false], ...outputs.map((d) => [d.name, d.name, outputs.filter((e) => e.name === d.name).length !== 1])];
    if (state.config.outputDevice && !outputs.some((d) => d.name === state.config.outputDevice)) {
      choices.push([state.config.outputDevice, `${state.config.outputDevice} · ${s.unavailable}`, true]);
    }
    options(output, choices, state.config.outputDevice);
    const processes = [[0, 'HeyboxChat.exe', false], ...state.processes.map((p) => [p.pid, `${p.name} · PID ${p.pid}`, false])];
    if (state.config.processPid && !state.processes.some((p) => p.pid === state.config.processPid)) {
      processes.push([state.config.processPid, `PID ${state.config.processPid} · ${s.unavailable}`, true]);
    }
    options(process, processes, state.config.processPid || 0);
    processLabel.hidden = state.processes.length <= 1 && !state.config.processPid;
    const canCapture = a.supported && r.model.phase === 'ready' && state.processes.length > 0;
    start.disabled = busy || state.bridging || !canCapture || !state.health.ready || !state.outputReady
      || !!state.deviceError || state.sendRestartRequired || !a.sendConfirmedAt || !a.receiveAt;
    receive.disabled = busy || !canCapture || state.bridging || r.mode === 'check' && r.phase === 'running';
    confirm.disabled = busy || !a.sendProbeAt || !!a.sendConfirmedAt;
    send.disabled = busy || speaking || !state.outputReady || !state.health.ready || state.sendRestartRequired;
    stop.disabled = !state.mounted;
    configure.disabled = busy;
    output.disabled = busy || speaking || state.bridging;
    process.disabled = busy || state.bridging;
    meter.value = r.levelDb;
    transcript.textContent = r.error || (r.lastText ? `${s.lastText}: ${r.lastText}`
      : r.phase === 'running' ? s.receiveWaiting : pendingMethod === 'checkReceive' ? s.checking : s.receiveIdle);
    transcript.classList.toggle('bad', !!r.error);
    if (!keywordDirty) keyword.value = state.config.addressKeyword || '';
    keyword.disabled = busy;
    saveKeyword.disabled = busy || !keywordDirty;
    keywordStatus.hidden = !state.addressCue;
    keywordStatus.textContent = state.addressCue
      ? `${state.addressCue.matched ? s.keywordMatched : s.keywordUnmatched} · ${state.addressCue.keyword}` : '';
  }
  async function action(method, args = [], after) {
    if (busy && method !== 'stopBridge' && method !== 'stop') return;
    stateVersion++;
    busy = true;
    pendingMethod = method;
    message.textContent = '';
    render();
    try {
      const next = await ctx.invoke(method, args);
      if (signal.aborted) return;
      state = next;
      after?.();
    } catch (error) {
      if (!signal.aborted) { message.textContent = String(error.message || error); message.classList.add('bad'); }
    } finally { busy = false; pendingMethod = ''; if (!signal.aborted) render(); }
  }
  async function save(key, value) {
    stateVersion++;
    busy = true; render();
    try {
      await ctx.setConfig('world:heybox', { [`worlds.heybox.${key}`]: value });
      state = await ctx.invoke('state');
      if (key === 'addressKeyword') keywordDirty = false;
      message.textContent = s.saved; message.classList.remove('bad');
    } catch (error) {
      message.textContent = String(error.message || error); message.classList.add('bad');
    } finally { busy = false; if (!signal.aborted) render(); }
  }
  output.addEventListener('change', () => void save('outputDevice', output.value), { signal });
  process.addEventListener('change', () => void save('processPid', Number(process.value)), { signal });
  sendMode.addEventListener('change', () => void save('sendMode', sendMode.value), { signal });
  microphone.addEventListener('change', () => void save('microphoneEndpoint', microphone.value), { signal });
  keyword.addEventListener('input', () => {
    keywordDirty = keyword.value !== (state.config.addressKeyword || '');
    saveKeyword.disabled = busy || !keywordDirty;
  }, { signal });
  async function speak() {
    if (speaking || !text.value.trim()) return;
    stateVersion++;
    speaking = true; render();
    try {
      const next = await ctx.invoke('say', [text.value.trim()]);
      if (signal.aborted) return;
      state = next;
      message.textContent = next.failed ? s.unavailable : s.completed;
      message.classList.toggle('bad', next.failed);
    } catch (error) {
      if (!signal.aborted) { message.textContent = String(error.message || error); message.classList.add('bad'); }
    } finally { speaking = false; if (!signal.aborted) render(); }
  }
  render();
  await action('refresh');
  ctx.interval(async () => {
    if (polling || busy) return;
    polling = true;
    const version = stateVersion;
    try { const next = await ctx.invoke('state'); if (!signal.aborted && !busy && version === stateVersion) { state = next; render(); } }
    catch (error) { if (!signal.aborted) { message.textContent = String(error.message || error); message.classList.add('bad'); } }
    finally { polling = false; }
  }, 1000);
}
export default { panels: { bridge: { mount } } };
