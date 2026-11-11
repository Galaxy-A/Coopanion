// SPDX-License-Identifier: AGPL-3.0-or-later
// A read-only activity tray. Conversation input and actions remain in Coopanion.
const ACTIVITY = {
  running: { label: '正在运行', fallback: '正在思考', icon: 'status_work' },
  waiting: { label: '需要输入', fallback: '在 Codex 中回应', icon: 'native_warning' },
  review: { label: '就绪', fallback: '回复已就绪', icon: 'native_check' },
  failed: { label: '已拦截', fallback: '在 Codex 中查看详情', icon: 'native_warning' },
};
const STATE_ACTIVITY = {
  working: 'running', waiting: 'waiting', completed: 'review', failed: 'failed',
  interrupted: 'idle', stale: 'unknown', disconnected: 'unknown',
};
const LEGACY_ACTIVITY = { 'needs-input': 'waiting', ready: 'review', blocked: 'failed' };
const EXPIRY = { waiting: 24 * 60 * 60_000, review: 7 * 24 * 60 * 60_000, failed: 60 * 60_000 };
const validId = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const clamp = (value, min, max) => Math.max(min, Math.min(Math.max(min, max), value));
const turnKey = (session) => `${session.id}:${session.turnId}`;
const activityOf = (session) => LEGACY_ACTIVITY[session.activity] || session.activity
  || STATE_ACTIVITY[session.state] || 'unknown';
const sortAt = (session) => session.sortAtMs || session.startedAt || session.lastActivityAt || session.changedAt || 0;
const summaryOf = (session) => (session.message?.summary || session.message?.text || '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 280);
// TriangleAlert/CircleCheck use Lucide (licenses/lucide-icons.txt); the chevron matches the local native control.
const STATUS_ICONS = {
  native_warning: [['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
    ['path', { d: 'M12 9v4' }], ['path', { d: 'M12 17h.01' }]],
  native_check: [['circle', { cx: '12', cy: '12', r: '10' }], ['path', { d: 'm9 12 2 2 4-4' }]],
  native_chevron: [['path', {
    d: 'M15.2793 7.71101C15.539 7.45131 15.961 7.45131 16.2207 7.71101C16.4804 7.97071 16.4804 8.39272 16.2207 8.65242L10.4707 14.4024C10.211 14.6621 9.78902 14.6621 9.52932 14.4024L3.77932 8.65242L3.69436 8.54792C3.52385 8.28979 3.55205 7.93828 3.77932 7.71101C4.00659 7.48374 4.3581 7.45554 4.61623 7.62605L4.72073 7.71101L10 12.9903L15.2793 7.71101Z',
    fill: 'currentColor', 'stroke-width': '.6',
  }]],
};

export function createCodexDisplay({ bubble, body, nativeState, icons, requestFocus }) {
  const style = document.createElement('style');
  style.textContent = `
    .ghost-codex-surface{--ghost-native-bg:#ffffffe6;--ghost-native-line:#0000001f;
      --ghost-native-text:#1a1c1f;--ghost-native-secondary:var(--app-color-text-secondary,var(--muted));
      --ghost-native-shadow:inset 0 1px 1px #fff3,inset 0 -1px 2px #ffffff14,0 3px 16px #00000059;
      position:fixed;z-index:4;width:min(330px,calc(100vw - 16px));
      color:var(--ghost-native-text);font:13px/16px system-ui,sans-serif;letter-spacing:0;
      pointer-events:none;user-select:none}
    :root[data-theme="dark"] .ghost-codex-surface{--ghost-native-bg:#202020e6;
      --ghost-native-line:#ffffff1f;--ghost-native-text:#dfdfdf}
    .ghost-codex-surface[hidden],.ghost-codex-surface [hidden]{display:none!important}
    .ghost-codex-surface button,.ghost-codex-surface a{font:inherit;color:inherit;letter-spacing:0}
    .ghost-codex-surface button{cursor:pointer;border:0;background:transparent}
    .ghost-codex-surface button:focus-visible,.ghost-codex-surface a:focus-visible{
      outline:2px solid var(--skin-eye);outline-offset:2px}
    .ghost-codex-surface svg{width:16px;height:16px;display:block;flex:none}
    .ghost-tray{display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 72px);
      overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;
      pointer-events:auto}
    .ghost-tray:not(.is-collapsed){box-sizing:border-box;width:calc(100% + 48px);
      padding:24px;margin:-24px;max-height:calc(100vh - 24px)}
    .ghost-tray.is-collapsed{position:relative;display:block;overflow:visible;height:var(--stack-height,56px)}
    .ghost-tray.is-collapsed .ghost-notification{position:absolute;top:calc(var(--layer)*8px);
      left:0;right:0;z-index:calc(3 - var(--layer));transform:scale(var(--layer-scale));
      transform-origin:50% 100%;pointer-events:none}
    .ghost-tray.is-collapsed .ghost-notification:first-child{pointer-events:auto}
    .ghost-notification{position:relative;flex:none;min-width:0;height:56px;box-sizing:border-box;
      border:0;border-radius:32px;background:var(--ghost-native-bg);
      box-shadow:inset 0 0 0 1px var(--ghost-native-line),var(--ghost-native-shadow);overflow:visible}
    .ghost-notification-link{display:flex;flex-direction:column;justify-content:center;gap:4px;
      box-sizing:border-box;height:56px;min-width:0;padding:12px 16px;text-align:left;
      text-decoration:none;border-radius:32px;overflow:hidden}
    .ghost-notification-link:hover{background:color-mix(in srgb,var(--ghost-native-text) 4%,transparent)}
    .ghost-notification-copy{display:flex;flex-direction:column;gap:0;min-width:0}
    .ghost-heading{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;line-height:16px}
    .ghost-heading svg{width:12px;height:12px}
    .ghost-title{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:700}
    .ghost-summary{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      min-width:0;font-size:13px;line-height:16px;color:var(--ghost-native-secondary)}
    .ghost-notification.is-inline .ghost-notification-copy{display:-webkit-box;-webkit-box-orient:vertical;
      -webkit-line-clamp:2;line-clamp:2;overflow:hidden}
    .ghost-notification.is-inline .ghost-heading,.ghost-notification.is-inline .ghost-title,
    .ghost-notification.is-inline .ghost-summary{display:inline;white-space:normal;overflow:visible}
    .ghost-notification.is-inline .ghost-status-icon{display:inline-flex;margin-right:6px;vertical-align:middle}
    .ghost-notification.is-inline .ghost-summary::before{content:'•';margin:0 6px}
    .ghost-row-controls{position:absolute;left:0;top:-4px;z-index:20;display:flex;
      opacity:0;pointer-events:none;transition:opacity 200ms}
    .ghost-notification:hover .ghost-row-controls,.ghost-notification:focus-within .ghost-row-controls{
      opacity:1;pointer-events:auto}
    .ghost-row-button{display:grid;place-items:center;width:20px;height:20px;box-sizing:border-box;
      flex:none;padding:4px;border-radius:50%;text-decoration:none;
      background:var(--ghost-native-bg)!important;box-shadow:inset 0 0 0 1px var(--ghost-native-line),var(--ghost-native-shadow)}
    .ghost-row-button svg{width:12px;height:12px}
    .ghost-row-button:active{transform:scale(.95)}
    .ghost-row-button:hover,.ghost-pill:hover,.ghost-activity-toggle:hover{
      background:color-mix(in srgb,var(--ghost-native-text) 8%,transparent)}
    .ghost-activity-toggle{position:fixed;display:grid;place-items:center;width:24px;height:24px;
      box-sizing:border-box;padding:4px;border-radius:12px;pointer-events:auto;
      background:var(--ghost-native-bg)!important;box-shadow:inset 0 0 0 1px var(--ghost-native-line),var(--ghost-native-shadow);
      font-size:12px!important;line-height:1!important;font-weight:500!important;touch-action:none;cursor:grab!important;
      --ghost-badge-bg:rgb(51 156 255 / .3);--ghost-badge-fg:var(--ghost-native-text)}
    .ghost-activity-toggle[data-mode="show"]{--ghost-badge-fill:var(--ghost-badge-bg);
      background:var(--ghost-badge-bg)!important;color:var(--ghost-badge-fg)}
    .ghost-activity-toggle[data-activity="waiting"]{--ghost-badge-bg:#e25507;--ghost-badge-fg:#f9f9f9}
    .ghost-activity-toggle[data-activity="failed"]{--ghost-badge-bg:#e02e2a;--ghost-badge-fg:#f9f9f9}
    .ghost-activity-toggle[data-activity="review"]{--ghost-badge-bg:#00a240;--ghost-badge-fg:#f9f9f9}
    :root[data-theme="dark"] .ghost-activity-toggle{--ghost-badge-bg:rgb(153 206 255 / .3)}
    :root[data-theme="dark"] .ghost-activity-toggle[data-activity="waiting"]{--ghost-badge-bg:#ff8549;--ghost-badge-fg:#000}
    :root[data-theme="dark"] .ghost-activity-toggle[data-activity="failed"]{--ghost-badge-bg:#ff6764;--ghost-badge-fg:#000}
    :root[data-theme="dark"] .ghost-activity-toggle[data-activity="review"]{--ghost-badge-bg:#40c977;--ghost-badge-fg:#000}
    .ghost-activity-toggle:active{cursor:grabbing!important}
    .ghost-activity-toggle:active{background:color-mix(in srgb,var(--ghost-native-text) 12%,var(--ghost-badge-fill,var(--ghost-native-bg)))!important}
    :root[data-theme="dark"] .ghost-activity-toggle:active{background:color-mix(in srgb,var(--ghost-native-text) 15%,var(--ghost-badge-fill,var(--ghost-native-bg)))!important}
    .ghost-activity-bar{display:flex;justify-content:center;align-items:center;gap:8px;
      height:24px;margin-top:10px;pointer-events:none}
    .ghost-pill{display:flex;align-items:center;justify-content:center;gap:6px;min-height:24px;
      box-sizing:border-box;max-width:100%;padding:4px 8px;border:1px solid var(--ghost-native-line)!important;
      background:var(--ghost-native-bg)!important;border-radius:12px;box-shadow:0 2px 9px var(--shadow);
      pointer-events:auto;font-size:11px!important;line-height:14px!important}
    .ghost-pill svg{width:14px;height:14px}
    .ghost-pill-copy{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ghost-status-icon{display:flex;flex:none;color:var(--skin-eye)}
    [data-activity="waiting"] .ghost-status-icon{color:#e25507}
    [data-activity="failed"] .ghost-status-icon{color:#e02e2a}
    [data-activity="review"] .ghost-status-icon{color:#00a240}
    :root[data-theme="dark"] [data-activity="waiting"] .ghost-status-icon{color:#ff8549}
    :root[data-theme="dark"] [data-activity="failed"] .ghost-status-icon{color:#ff6764}
    :root[data-theme="dark"] [data-activity="review"] .ghost-status-icon{color:#40c977}
    .ghost-tray-warning{margin:0;padding:12px 16px;font-size:12px;color:var(--muted);
      background:var(--surface);border:1px solid var(--line);border-radius:16px}
    @media(prefers-reduced-motion:reduce){.ghost-row-controls{transition:none}.ghost-row-button:active{transform:none}}
  `;
  document.head.append(style);
  const swipeStyle = document.createElement('style');
  swipeStyle.textContent = `
    .ghost-notification.ghost-swipe-row{background:transparent;box-shadow:none}
    .ghost-swipe-content{position:relative;z-index:1;height:56px;border-radius:32px;
      background:var(--ghost-native-bg);
      box-shadow:inset 0 0 0 1px var(--ghost-native-line),var(--ghost-native-shadow);
      touch-action:pan-y;transition:transform 180ms ease-out}
    .ghost-swipe-dragging .ghost-swipe-content{transition:none}
    .ghost-swipe-accessory{position:absolute;right:0;top:0;width:68px;height:56px;
      box-sizing:border-box;padding-left:12px;display:flex;pointer-events:auto}
    .ghost-codex-surface .ghost-swipe-dismiss{display:grid;place-items:center;flex:none;
      width:56px;height:56px;padding:0;border-radius:50%;
      background:var(--ghost-native-bg);
      box-shadow:inset 0 0 0 1px var(--ghost-native-line),var(--ghost-native-shadow)}
    .ghost-swipe-dismiss:hover{background:color-mix(in srgb,var(--ghost-native-text) 8%,var(--ghost-native-bg))}
    .ghost-swipe-dismiss svg{width:16px;height:16px}
    .ghost-swipe-open .ghost-row-controls{visibility:hidden;pointer-events:none}
    @media(prefers-reduced-motion:reduce){.ghost-swipe-content{transition:none}}
  `;
  document.head.append(swipeStyle);
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const icon = (name) => {
    const span = make('span', 'ghost-icon');
    if (STATUS_ICONS[name]) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [attribute, value] of Object.entries({
        viewBox: name === 'native_chevron' ? '0 0 20 21' : '0 0 24 24', fill: 'none', stroke: 'currentColor',
        'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
      })) svg.setAttribute(attribute, value);
      for (const [tag, attributes] of STATUS_ICONS[name]) {
        const node = document.createElementNS(svg.namespaceURI, tag);
        for (const [attribute, value] of Object.entries(attributes)) node.setAttribute(attribute, value);
        svg.append(node);
      }
      span.append(svg);
      return span;
    }
    // Only the host's bundled static icons enter this HTML sink.
    span.innerHTML = icons[name] || icons.chat || '';
    return span;
  };
  const button = (className, name, title, onClick) => {
    const element = make('button', className);
    element.type = 'button';
    element.title = title;
    element.setAttribute('aria-label', title);
    element.append(icon(name));
    element.addEventListener('click', onClick);
    return element;
  };
  const root = make('section', 'ghost-codex-surface');
  root.id = 'ghost-codex';
  root.hidden = true;
  root.setAttribute('aria-label', 'Codex 活动');
  const tray = make('div', 'ghost-tray is-collapsed');
  tray.id = 'ghost-codex-tray';
  tray.setAttribute('aria-label', 'Codex 通知');
  const warning = make('p', 'ghost-tray-warning');
  const bar = make('nav', 'ghost-activity-bar');
  bar.setAttribute('aria-label', '活动与聊天');
  const pill = button('ghost-pill', 'status_work', '展开 Codex 活动', () => {
    trayOpen = !trayOpen;
    render();
  });
  pill.setAttribute('aria-controls', tray.id);
  const pillIcon = make('span', 'ghost-status-icon');
  const pillCopy = make('span', 'ghost-pill-copy');
  pill.replaceChildren(pillIcon, pillCopy);
  const toggle = button('ghost-activity-toggle', 'native_chevron', '隐藏 Codex 活动', () => {
    if (Date.now() < toggleClickAfter) return;
    if (pillsVisible && trayOpen && visible().length > 1) trayOpen = false;
    else {
      pillsVisible = !pillsVisible;
      trayOpen = false;
      try { localStorage.setItem('ghost.codex.pills-visible.v1', JSON.stringify(pillsVisible)); } catch {}
    }
    render();
  });
  toggle.setAttribute('aria-controls', tray.id);
  bar.append(pill);
  root.append(tray, bar, toggle);
  document.body.append(root);

  let packet = null, sessions = [], lastBridge = '', lastSequence = -1, bodyKey = '';
  let enabled = true, nativeBusy = false, disconnected = false, attached = false;
  let trayOpen = false, pillsVisible = true, petHover = false, hoverUntil = 0, lastClock = -1, lastHovering = false;
  let badgeCorner = 'top-end', badgeDrag = null, lastPet = null, toggleClickAfter = 0;
  try { pillsVisible = JSON.parse(localStorage.getItem('ghost.codex.pills-visible.v1') || 'true') !== false; } catch {}
  try {
    const savedCorner = JSON.parse(localStorage.getItem('ghost.codex.badge-corner.v1') || 'null');
    if (['top-start', 'top-end', 'bottom-start', 'bottom-end'].includes(savedCorner)) badgeCorner = savedCorner;
  } catch {}
  let animationSession = null;
  const rows = new Map();
  let openSwipeRow = null;
  const resetOutsideSwipe = (event) => {
    if (openSwipeRow && !openSwipeRow.element.contains(event.target)) openSwipeRow.reset();
  };
  document.addEventListener('pointerdown', resetOutsideSwipe, true);
  document.addEventListener('click', resetOutsideSwipe, true);
  const acknowledged = new Map();
  const dismissed = new Map();
  const observed = new Set();
  const readStorage = (name, target) => {
    try {
      const entries = JSON.parse(localStorage.getItem(name) || '[]');
      if (Array.isArray(entries)) for (const entry of entries.slice(-128)) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && Number.isFinite(entry[1])) target.set(entry[0], entry[1]);
      }
    } catch { /* Storage may be unavailable in a restricted profile. */ }
  };
  readStorage('ghost.codex.read.v1', acknowledged);
  readStorage('ghost.codex.dismiss.v1', dismissed);

  function save(name, target) {
    while (target.size > 128) target.delete(target.keys().next().value);
    try { localStorage.setItem(name, JSON.stringify([...target])); } catch {}
  }
  function unread(session) {
    return activityOf(session) === 'review'
      && (session.live || observed.has(turnKey(session)))
      && (acknowledged.get(turnKey(session)) || 0) < session.changedAt;
  }
  function eligible(session) {
    const activity = activityOf(session);
    if (!ACTIVITY[activity] || (activity === 'review' && !unread(session))) return false;
    if (EXPIRY[activity] && Date.now() - session.changedAt >= EXPIRY[activity]) return false;
    return true;
  }
  function ordered() {
    return sessions.filter(eligible).sort((a, b) => sortAt(b) - sortAt(a) || a.id.localeCompare(b.id));
  }
  function visible() {
    return ordered().filter((session) => !dismissed.has(turnKey(session)));
  }
  function acknowledge(session) {
    if (activityOf(session) !== 'review') return;
    acknowledged.set(turnKey(session), session.changedAt);
    save('ghost.codex.read.v1', acknowledged);
  }
  function dismiss(session) {
    dismissed.set(turnKey(session), Date.now());
    save('ghost.codex.dismiss.v1', dismissed);
    render();
    syncBody();
  }
  function link(element, session, stackClick = false) {
    element.href = `codex://threads/${session.id}`;
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
    element.onclick = (event) => {
      if (element.dataset.ghostSwipeClick) {
        delete element.dataset.ghostSwipeClick;
        if (event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      if (stackClick && !trayOpen && visible().length > 1) {
        event.preventDefault();
        trayOpen = true;
      } else acknowledge(session);
      render();
      syncBody();
    };
  }
  function createRow() {
    const element = make('article', 'ghost-notification ghost-swipe-row');
    const anchor = make('a', 'ghost-notification-link');
    anchor.draggable = false;
    const heading = make('span', 'ghost-heading');
    const status = make('span', 'ghost-status-icon');
    const title = make('span', 'ghost-title');
    heading.append(status, title);
    const summary = make('span', 'ghost-summary');
    const copy = make('span', 'ghost-notification-copy');
    copy.append(heading, summary);
    anchor.append(copy);
    const controls = make('div', 'ghost-row-controls');
    const dismissCurrent = () => {
      resetSwipe();
      const current = sessions.find((value) => turnKey(value) === element.dataset.turn);
      if (current) dismiss(current);
    };
    const close = button('ghost-row-button', '', '关闭这条通知', dismissCurrent);
    const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeIcon.setAttribute('viewBox', '0 0 12 12');
    closeIcon.setAttribute('aria-hidden', 'true');
    const cross = document.createElementNS(closeIcon.namespaceURI, 'path');
    for (const [name, value] of Object.entries({
      d: 'M3 3 9 9M9 3 3 9', fill: 'none', stroke: 'currentColor',
      'stroke-linecap': 'round', 'stroke-width': '1.8',
    })) cross.setAttribute(name, value);
    closeIcon.append(cross);
    close.replaceChildren(closeIcon);
    controls.append(close);
    const content = make('div', 'ghost-swipe-content');
    content.append(anchor, controls);
    const accessory = make('div', 'ghost-swipe-accessory');
    const swipeClose = button('ghost-swipe-dismiss', '', '关闭这条通知', dismissCurrent);
    swipeClose.replaceChildren(closeIcon.cloneNode(true));
    accessory.append(swipeClose);
    accessory.hidden = true;
    element.append(accessory, content);

    const actionWidth = 56, revealedOffset = actionWidth + 12;
    let offset = 0, gesture = null;
    const interactive = () => !element.inert && !element.hidden && !tray.hidden && !root.hidden;
    const swipeRow = { element, reset: resetSwipe };
    function drawSwipe() {
      const isOpen = offset > 0 || !!gesture?.active;
      if (isOpen && openSwipeRow !== swipeRow) {
        openSwipeRow?.reset();
        openSwipeRow = swipeRow;
      } else if (!isOpen && openSwipeRow === swipeRow) openSwipeRow = null;
      content.style.transform = offset ? `translateX(${-offset}px)` : '';
      element.classList.toggle('ghost-swipe-dragging', !!gesture?.active);
      element.classList.toggle('ghost-swipe-open', isOpen);
      accessory.hidden = offset <= 0;
    }
    function releaseCapture(pointerId) {
      if (content.hasPointerCapture?.(pointerId)) content.releasePointerCapture(pointerId);
    }
    function resetSwipe() {
      const pointerId = gesture?.pointerId;
      gesture = null;
      offset = 0;
      drawSwipe();
      if (pointerId !== undefined) releaseCapture(pointerId);
    }
    function sample(time) {
      gesture.samples.push({ time, offset });
      gesture.samples = gesture.samples.filter((value) => time - value.time <= 200).slice(-3);
    }
    function finishSwipe(event, cancelled = false) {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const current = gesture;
      if (!current.active) { gesture = null; return; }
      sample(event.timeStamp);
      const first = current.samples[0], last = current.samples.at(-1);
      const velocity = last.time > first.time ? (last.offset - first.offset) * 1000 / (last.time - first.time) : 0;
      const width = element.getBoundingClientRect().width;
      const consumeOffset = Math.min(width, Math.max(.55 * width, actionWidth + 15));
      const consumed = !cancelled && (offset >= consumeOffset
        || (offset >= 24 && velocity >= 600 && current.lastDelta >= 0));
      const revealed = !cancelled && (Math.abs(velocity) > 50
        ? offset > 0 && velocity > 0 : offset > actionWidth / 2);
      gesture = null;
      releaseCapture(current.pointerId);
      offset = consumed || !revealed ? 0 : Math.min(revealedOffset, width);
      drawSwipe();
      if (consumed) dismissCurrent();
    }
    content.addEventListener('click', (event) => {
      if (anchor.dataset.ghostSwipeClick && event.detail !== 0) {
        delete anchor.dataset.ghostSwipeClick;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (offset <= 0) return;
      delete anchor.dataset.ghostSwipeClick;
      resetSwipe();
      event.preventDefault();
      event.stopPropagation();
    }, true);
    content.addEventListener('pointerdown', (event) => {
      if (!interactive() || event.button !== 0 || event.isPrimary === false) return;
      const control = event.target.closest?.('button, input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      const targetAnchor = event.target.closest?.('a');
      if (control || (targetAnchor && targetAnchor !== anchor)) return;
      delete anchor.dataset.ghostSwipeClick;
      gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        initialOffset: offset, active: false, lastDelta: 0, samples: [{ time: event.timeStamp, offset }] };
    });
    content.addEventListener('pointermove', (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (!interactive()) { resetSwipe(); return; }
      const dx = gesture.x - event.clientX, dy = gesture.y - event.clientY;
      if (!gesture.active) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
        if (Math.abs(dx) <= Math.abs(dy)) { gesture = null; return; }
        gesture.active = true;
        anchor.dataset.ghostSwipeClick = 'true';
        try { content.setPointerCapture(event.pointerId); } catch { /* A pointer can leave before capture. */ }
      }
      event.preventDefault();
      event.stopPropagation();
      const next = clamp(gesture.initialOffset + dx, 0, element.getBoundingClientRect().width);
      gesture.lastDelta = next - offset;
      offset = next;
      sample(event.timeStamp);
      drawSwipe();
    });
    content.addEventListener('pointerup', (event) => finishSwipe(event));
    content.addEventListener('pointercancel', (event) => finishSwipe(event, true));
    content.addEventListener('lostpointercapture', (event) => {
      if (gesture?.pointerId === event.pointerId) resetSwipe();
    });
    content.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && offset > 0) {
        event.preventDefault();
        event.stopPropagation();
        resetSwipe();
      }
    });
    return { element, anchor, status, title, summary, activity: '', resetSwipe,
      syncSwipe() { if (!interactive()) resetSwipe(); } };
  }
  function renderRows(available) {
    const keep = new Set(available.map(turnKey));
    for (const [key, row] of rows) if (!keep.has(key)) {
      row.resetSwipe();
      row.element.remove();
      rows.delete(key);
    }
    let previous = null;
    available.forEach((session, index) => {
      const key = turnKey(session), activity = activityOf(session);
      let row = rows.get(key);
      if (!row) { row = createRow(); rows.set(key, row); }
      row.element.dataset.session = session.id;
      row.element.dataset.turn = key;
      row.element.dataset.activity = activity;
      row.element.hidden = !trayOpen && index >= 3;
      row.element.inert = !trayOpen && index > 0;
      row.element.setAttribute('aria-hidden', String(!trayOpen && index > 0));
      row.syncSwipe();
      row.element.style.setProperty('--layer', String(Math.min(index, 2)));
      row.element.style.setProperty('--layer-scale', String([1, .94, .86][Math.min(index, 2)]));
      row.title.textContent = session.title || session.project || ACTIVITY[activity].label;
      row.summary.textContent = summaryOf(session) || ACTIVITY[activity].fallback;
      row.element.classList.toggle('is-inline', row.title.textContent.length <= 20 && row.summary.textContent.length > 40);
      row.status.hidden = activity === 'running';
      if (row.activity !== activity) {
        row.status.replaceChildren(icon(ACTIVITY[activity].icon));
        row.activity = activity;
      }
      row.anchor.title = `${row.title.textContent} · ${ACTIVITY[activity].label}\n${row.summary.textContent}`;
      row.anchor.setAttribute('aria-label', `${row.title.textContent}，${ACTIVITY[activity].label}，${row.summary.textContent}`);
      link(row.anchor, session, true);
      // Preserve existing anchors and focus when a snapshot only updates text.
      if (previous ? previous.nextElementSibling !== row.element : tray.firstElementChild !== row.element) {
        if (previous) previous.after(row.element);
        else tray.prepend(row.element);
      }
      previous = row.element;
    });
  }
  function render() {
    const available = visible();
    // Native mascot state follows the first visible notification; task data stays intact.
    animationSession = available[0] || null;
    const activity = animationSession ? activityOf(animationSession) : 'idle';
    const hovering = petHover || root.matches(':hover, :focus-within') || Date.now() < hoverUntil;
    lastHovering = hovering;
    warning.textContent = disconnected ? 'Codex 连接已断开'
      : packet?.warning === 'unsupported-version' ? '此 Codex 版本暂不兼容'
      : packet?.warning ? '部分活动暂时无法同步' : '';
    root.hidden = !enabled || !attached || (!available.length && !hovering)
      || (!packet && !disconnected);
    root.dataset.activity = activity;
    root.dataset.session = animationSession?.id || '';
    root.dataset.turn = animationSession ? turnKey(animationSession) : '';
    root.dataset.expanded = String(pillsVisible && trayOpen && !nativeBusy);
    root.dataset.pillsVisible = String(pillsVisible);
    tray.hidden = !pillsVisible || nativeBusy || (!available.length && !(hovering && warning.textContent));
    tray.classList.toggle('is-collapsed', !trayOpen && !!available.length);
    tray.style.setProperty('--stack-height', `${56 + Math.min(Math.max(available.length - 1, 0), 2) * 8}px`);
    renderRows(available);
    warning.hidden = !warning.textContent || !hovering;
    if (!available.length && hovering && warning.textContent) tray.append(warning);
    else warning.remove();
    const first = available[0];
    pill.hidden = !pillsVisible || !nativeBusy || !available.length;
    pillIcon.hidden = first && activityOf(first) === 'running';
    pillIcon.replaceChildren(icon(first ? ACTIVITY[activityOf(first)].icon : 'status_wait'));
    pillCopy.textContent = available.length > 1 ? `${available.length} 项活动`
      : first ? ACTIVITY[activityOf(first)].label : '';
    pill.title = trayOpen ? '收起 Codex 活动' : '展开 Codex 活动';
    pill.setAttribute('aria-label', `${pill.title}，${pillCopy.textContent}`);
    pill.setAttribute('aria-expanded', String(trayOpen && !nativeBusy));
    toggle.hidden = !available.length || nativeBusy;
    const toggleLabel = pillsVisible
      ? trayOpen && available.length > 1 ? '收起 Codex 活动' : '隐藏 Codex 活动'
      : `显示 Codex 活动，${available.length} 项`;
    toggle.title = toggleLabel;
    toggle.setAttribute('aria-label', toggleLabel);
    toggle.setAttribute('aria-expanded', String(pillsVisible));
    if (pillsVisible) {
      if (toggle.dataset.mode !== 'hide') toggle.replaceChildren(icon('native_chevron'));
      toggle.dataset.mode = 'hide';
    } else {
      toggle.textContent = String(available.length);
      toggle.dataset.mode = 'show';
    }
    toggle.dataset.activity = activity;
    bar.hidden = pill.hidden;
  }
  function merge(state) {
    const active = enabled && !disconnected ? animationSession : null;
    return { ...state, codexState: active ? activityOf(active) : null,
      codexTurnId: active ? turnKey(active) : null };
  }
  function syncBody() {
    const state = merge(nativeState());
    const key = JSON.stringify(state);
    if (bodyKey !== key) { bodyKey = key; body()?.set(state); }
  }
  function receive(nextPacket) {
    if (!nextPacket || nextPacket.t !== 'codex' || typeof nextPacket.bridgeId !== 'string') return;
    if (nextPacket.bridgeId !== lastBridge) {
      lastBridge = nextPacket.bridgeId;
      lastSequence = -1;
    }
    if (!Number.isInteger(nextPacket.sequence) || nextPacket.sequence <= lastSequence) return;
    lastSequence = nextPacket.sequence;
    disconnected = false;
    attached = true;
    packet = nextPacket;
    const incoming = Array.isArray(packet.sessions) ? packet.sessions : packet.session ? [packet.session] : [];
    const ids = new Set();
    sessions = incoming.filter((session) => {
      if (!session || !validId(session.id) || !validId(session.turnId) || ids.has(session.id)
        || !Number.isFinite(session.changedAt)) return false;
      ids.add(session.id);
      return true;
    }).slice(0, 32);
    for (const session of sessions) {
      if (['running', 'waiting'].includes(activityOf(session))) observed.add(turnKey(session));
    }
    while (observed.size > 128) observed.delete(observed.values().next().value);
    // Native notifications start collapsed; new progress never forces the stack open.
    render();
    syncBody();
  }
  function step({ blocked, enabled: nextEnabled }) {
    const changed = enabled !== !!nextEnabled || nativeBusy !== !!blocked;
    enabled = !!nextEnabled;
    nativeBusy = !!blocked;
    const clock = Math.floor(Date.now() / 1000);
    const hovering = petHover || root.matches(':hover, :focus-within') || Date.now() < hoverUntil;
    if (clock !== lastClock || changed || hovering !== lastHovering) {
      lastClock = clock;
      render();
      syncBody();
    }
    // Codex never claims the original Coopanion chat bubble.
    return false;
  }
  function layout(position) {
    if (!position?.bubble || !position.box) return;
    const nextHover = position.cursor === 'grab' || position.cursor === 'grabbing';
    if (nextHover) hoverUntil = Date.now() + 300;
    if (nextHover !== petHover) { petHover = nextHover; render(); }
    if (root.hidden) return;
    const bounds = root.getBoundingClientRect(), w = bounds.width, h = bounds.height;
    const anchor = position.bubble, pet = position.box;
    lastPet = pet;
    positionToggle();
    const proposed = [
      [anchor.x - w / 2, anchor.y - h - 14],
      [pet.x - w - 14, pet.y + pet.h / 2 - h / 2],
      [pet.x + pet.w + 14, pet.y + pet.h / 2 - h / 2],
    ];
    const obstacles = [bubble, ...document.querySelectorAll('.menu:not([hidden]) > *, .tools:not([hidden]), .wheel:not([hidden])')]
      .filter((element) => element && !element.hidden).map((element) => element.getBoundingClientRect());
    let best = null, score = Infinity;
    for (const [x, y] of proposed) {
      const left = clamp(x, 8, innerWidth - w - 8), top = clamp(y, 8, innerHeight - h - 8);
      let overlap = 0;
      for (const obstacle of obstacles) overlap += Math.max(0, Math.min(left + w, obstacle.right) - Math.max(left, obstacle.left))
        * Math.max(0, Math.min(top + h, obstacle.bottom) - Math.max(top, obstacle.top));
      const cost = overlap * 20 + Math.abs(left - x) + Math.abs(top - y);
      if (cost < score) { score = cost; best = { left, top }; }
    }
    root.style.left = `${best.left.toFixed(1)}px`;
    root.style.top = `${best.top.toFixed(1)}px`;
  }
  function positionToggle() {
    if (!lastPet) return;
    const { x, y, w, h } = lastPet;
    const left = badgeDrag?.moved ? badgeDrag.left
      : badgeCorner.endsWith('start') ? x : x + w - 24 - (badgeCorner === 'bottom-end' ? 28 : 0);
    const top = badgeDrag?.moved ? badgeDrag.top : badgeCorner.startsWith('top') ? y : y + h - 24;
    toggle.style.left = `${clamp(left, 8, innerWidth - 32).toFixed(1)}px`;
    toggle.style.top = `${clamp(top, 8, innerHeight - 32).toFixed(1)}px`;
  }
  toggle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const bounds = toggle.getBoundingClientRect();
    badgeDrag = { id: event.pointerId, x: event.clientX, y: event.clientY,
      left: bounds.left, top: bounds.top, startLeft: bounds.left, startTop: bounds.top, moved: false };
    toggle.setPointerCapture(event.pointerId);
  });
  toggle.addEventListener('pointermove', (event) => {
    if (!badgeDrag || badgeDrag.id !== event.pointerId) return;
    const dx = event.clientX - badgeDrag.x, dy = event.clientY - badgeDrag.y;
    if (!badgeDrag.moved && Math.hypot(dx, dy) < 4) return;
    event.preventDefault();
    badgeDrag.moved = true;
    badgeDrag.left = badgeDrag.startLeft + dx;
    badgeDrag.top = badgeDrag.startTop + dy;
    positionToggle();
  });
  function finishBadgeDrag(event, cancelled = false) {
    if (!badgeDrag || badgeDrag.id !== event.pointerId) return;
    if (badgeDrag.moved) {
      toggleClickAfter = Date.now() + 300;
      if (!cancelled && lastPet) {
        const horizontal = badgeDrag.left + 12 < lastPet.x + lastPet.w / 2 ? 'start' : 'end';
        const vertical = badgeDrag.top + 12 < lastPet.y + lastPet.h / 2 ? 'top' : 'bottom';
        badgeCorner = `${vertical}-${horizontal}`;
        try { localStorage.setItem('ghost.codex.badge-corner.v1', JSON.stringify(badgeCorner)); } catch {}
      }
    }
    badgeDrag = null;
    if (toggle.hasPointerCapture(event.pointerId)) toggle.releasePointerCapture(event.pointerId);
    positionToggle();
  }
  toggle.addEventListener('pointerup', (event) => finishBadgeDrag(event));
  toggle.addEventListener('pointercancel', (event) => finishBadgeDrag(event, true));
  function disconnect() {
    packet = null;
    sessions = [];
    lastBridge = '';
    lastSequence = -1;
    animationSession = null;
    disconnected = true;
    trayOpen = false;
    hoverUntil = Date.now() + 300;
    render();
    syncBody();
  }
  root.addEventListener('pointerdown', (event) => {
    hoverUntil = Date.now() + 300;
    requestFocus?.();
    event.stopPropagation();
  });
  root.addEventListener('pointerenter', () => { hoverUntil = Date.now() + 300; render(); });
  root.addEventListener('pointerleave', () => { hoverUntil = Date.now() + 300; });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    trayOpen = false;
    render();
  });
  return { receive, merge, step, disconnect, layout,
    get elements() { return root.hidden ? [root] : [root, toggle]; } };
}
