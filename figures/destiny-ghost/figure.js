// SPDX-License-Identifier: AGPL-3.0-or-later
// The PNG artwork has separate rights; see README.md.

export const GHOST_STATES = [
  { id: 'idle', name: '待机', row: 0 },
  { id: 'right', name: '向右移动', row: 1 },
  { id: 'left', name: '向左移动', row: 2 },
  { id: 'greet', name: '招呼', row: 3 },
  { id: 'jump', name: '跳起', row: 4 },
  { id: 'error', name: '出错', row: 5 },
  { id: 'wait', name: '等待', row: 6 },
  { id: 'scan', name: '扫描', row: 7 },
  { id: 'inspect', name: '检查', row: 8 },
  { id: 'look', name: '看向鼠标', row: 9 },
];

const COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6];
const TIMING = [
  [1680, 660, 660, 840, 840, 1920],
  [120, 120, 120, 120, 120, 120, 120, 220],
  [120, 120, 120, 120, 120, 120, 120, 220],
  [140, 140, 140, 280],
  [140, 140, 140, 140, 280],
  [140, 140, 140, 140, 140, 140, 140, 240],
  [150, 150, 150, 150, 150, 260],
  [120, 120, 120, 120, 120, 220],
  [150, 150, 150, 150, 150, 280],
];
const WORD_ROWS = {
  idle: 0, greet: 3, jump: 4, error: 5, wait: 6, scan: 7, inspect: 8, look: 9,
  stand: 0, neutral: 0, wave: 3, nod: 3, hello: 3, happy: 4, love: 4, hop: 4,
  sad: 5, confused: 5, think: 7, read: 8, search: 7, surprised: 8,
  待机: 0, 回正: 0, 招呼: 3, 你好: 3, 跳起: 4, 开心: 4, 出错: 5, 困惑: 5,
  等待: 6, 等回应: 6, 扫描: 7, 检查: 8, 观察: 8, 看鼠标: 9, 注视: 9,
};
const PUBLIC_WORDS = ['idle', 'greet', 'scan', 'inspect', 'wait', 'error', 'jump', 'move', 'look'];
const FRAME_WIDTH = 192;
const FRAME_HEIGHT = 208;
const LOGO_WIDTH = 256;
const LOGO_HEIGHT = LOGO_WIDTH * FRAME_HEIGHT / FRAME_WIDTH;
const finite = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(Math.max(min, max), value));
const codexMode = (value) => ({
  running: 'working', 'needs-input': 'waiting', blocked: 'failed',
  ready: 'completed', review: 'completed', idle: 'interrupted', unknown: 'stale',
}[value] || value || null);

export async function createGhostBody(base, { asset, host, loadImage }) {
  if (!host?.root || typeof host.bounds !== 'function') throw new Error('Ghost requires an API 2 figure host.');
  const document = host.root.ownerDocument;
  const imageUrl = String(asset ? asset('spritesheet.png') : new URL('spritesheet.png', base));
  const image = await (loadImage ? loadImage(imageUrl) : new Promise((resolve, reject) => {
    const value = document.createElement('img');
    value.onload = () => resolve(value);
    value.onerror = () => reject(new Error('Ghost spritesheet could not be loaded.'));
    value.src = imageUrl;
  }));
  if (image.naturalWidth !== FRAME_WIDTH * 8 || image.naturalHeight !== FRAME_HEIGHT * 11) {
    throw new Error('Ghost requires the 1536 x 2288 v2 spritesheet.');
  }
  const sprite = document.createElement('div');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.dataset.ghostSprite = '';
  Object.assign(sprite.style, {
    position: 'absolute', left: '0', top: '0', pointerEvents: 'none',
    backgroundImage: `url("${imageUrl}")`, backgroundRepeat: 'no-repeat',
    backgroundSize: '800% 1100%', backgroundPosition: '0% 0%',
    imageRendering: 'pixelated', contain: 'layout paint style',
  });
  host.root.append(sprite);

  let disposed = false;
  let bounds = { W: 1, H: 1, floorY: 1, S: 0.44 };
  let x = null, y = null, facing = host.start?.facing === -1 ? -1 : 1;
  let row = 0, frame = 0, rounds = 0, frameTime = 0, loop = true, explicit = null;
  let direction = 0, dirty = true, drawnFrame = '', drawnPosition = '';
  let press = null, dragging = false, walking = null, moveWord = null;
  let listening = false, thinking = false, status = null, looking = false;
  let codexState = null, codexTurnId = '', codexRevision = 0, playedCodexRevision = -1;
  let codexPlaying = false, animationCodexRevision = -1, pausedCodex = null;
  const motionQuery = document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reducedMotion = !!motionQuery?.matches;
  let hover = false, airStart = null;
  const emit = (kind, detail) => host.emit?.(kind, detail);

  function size() {
    return { w: LOGO_WIDTH * bounds.S, h: LOGO_HEIGHT * bounds.S };
  }
  function limits() {
    const { w, h } = size();
    return { minX: Math.min(w / 2 + 4, bounds.W / 2), maxX: Math.max(bounds.W / 2, bounds.W - w / 2 - 4), minY: Math.min(h + 4, bounds.floorY) };
  }
  function resize() {
    const next = host.bounds() || {};
    bounds = {
      W: Math.max(1, finite(next.W, bounds.W)),
      H: Math.max(1, finite(next.H, bounds.H)),
      floorY: Math.max(1, finite(next.floorY, bounds.floorY)),
      S: clamp(finite(next.S, bounds.S), 0.1, 4),
    };
    bounds.floorY = Math.min(bounds.H, bounds.floorY);
    const limit = limits();
    x = clamp(x ?? finite(host.start?.x, bounds.W * 0.7), limit.minX, limit.maxX);
    y = clamp(y ?? finite(host.start?.y, bounds.floorY), limit.minY, bounds.floorY);
    if (walking) walking.target = clamp(walking.target, limit.minX, limit.maxX);
    const { w, h } = size();
    sprite.style.width = `${w}px`;
    sprite.style.height = `${h}px`;
    dirty = true;
  }
  function mode() {
    if (dragging) return 'drag';
    if (walking) return walking.run ? 'run' : 'walk';
    return GHOST_STATES.find((state) => state.row === row)?.id ?? 'idle';
  }
  function begin(next, repeat = false, word = null, codexAnimation = false) {
    if (!codexAnimation && codexPlaying && animationCodexRevision === codexRevision && rounds < 3) {
      pausedCodex = { revision: codexRevision, row, frame, rounds, frameTime };
    }
    if (codexAnimation) pausedCodex = null;
    row = next; frame = 0; rounds = 0; frameTime = 0;
    loop = next === 0 || next === 9 || repeat;
    explicit = word;
    codexPlaying = codexAnimation;
    animationCodexRevision = codexAnimation ? codexRevision : -1;
    dirty = true;
    emit('mode', { mode: mode() });
  }
  function ambient() {
    if (dragging || walking || explicit) return;
    const ownRow = listening ? 6 : thinking || status ? 7 : null;
    if (ownRow !== null) {
      if (row !== ownRow || !loop) begin(ownRow, true);
      return;
    }
    const externalRow = {
      working: 7, waiting: 6, completed: 8, failed: 5,
    }[codexState];
    if (externalRow !== undefined && pausedCodex?.revision === codexRevision) {
      const saved = pausedCodex;
      playedCodexRevision = codexRevision;
      begin(saved.row, false, null, true);
      frame = saved.frame; rounds = saved.rounds; frameTime = saved.frameTime;
      return;
    }
    if (externalRow !== undefined && playedCodexRevision !== codexRevision) {
      playedCodexRevision = codexRevision;
      begin(externalRow, false, null, true);
      return;
    }
    if (codexPlaying && animationCodexRevision === codexRevision) return;
    const next = codexState ? 0 : looking ? 9 : 0;
    if (row !== next || !loop) begin(next, true);
  }
  function stopMoving(by = 'action') {
    if (!walking) return;
    const old = walking;
    walking = null;
    if (old.id != null) emit('interrupted', { walkId: old.id, x, y, by });
    if (moveWord) {
      emit('done', { word: moveWord });
      moveWord = null;
    }
  }
  function paint() {
    if (disposed) return;
    const { w, h } = size();
    const drawRow = row === 9 ? 9 + Math.floor(direction / 8) : row;
    const col = row === 9 ? direction % 8 : reducedMotion ? 0 : frame;
    const key = `${drawRow}:${col}`;
    if (drawnFrame !== key) {
      sprite.style.backgroundPosition = `${col / 7 * 100}% ${drawRow / 10 * 100}%`;
      sprite.dataset.row = String(drawRow);
      sprite.dataset.frame = String(col);
      drawnFrame = key;
    }
    const position = `translate(${(x - w / 2).toFixed(2)}px, ${(y - h).toFixed(2)}px)`;
    if (drawnPosition !== position) {
      sprite.style.transform = position;
      drawnPosition = position;
    }
    sprite.dataset.mode = mode();
    dirty = false;
  }
  function updateAnimation(ms) {
    // Explicit actions still finish their protocol clock when their motion is reduced.
    if (row === 9 || (reducedMotion && !explicit && !walking)) return;
    frameTime += ms;
    if (loop) {
      const cycleMs = TIMING[row].reduce((sum, value) => sum + value, 0);
      if (frameTime > cycleMs * 2) frameTime %= cycleMs;
    }
    let steps = 0;
    while (frameTime >= TIMING[row][frame] && steps++ < 1024) {
      frameTime -= TIMING[row][frame];
      frame++;
      dirty = true;
      if (frame === COUNTS[row]) {
        frame = 0;
        rounds++;
        if (!loop && rounds >= 3) {
          const word = explicit;
          explicit = null;
          begin(0, true);
          if (word) emit('done', { word });
          ambient();
          break;
        }
      }
    }
  }
  function step(dt, draw = true) {
    if (disposed || !(dt >= 0 && Number.isFinite(dt))) return;
    if (airStart != null && !dragging) {
      const target = Math.min(bounds.floorY, airStart.target);
      y = Math.min(target, y + dt * (100 + Math.max(0, target - y) * 2));
      if (y >= target) airStart = null;
      dirty = true;
    }
    if (walking && !dragging) {
      const distance = walking.target - x;
      const speed = (walking.run ? 360 : 180) * bounds.S;
      x += Math.sign(distance) * Math.min(Math.abs(distance), speed * dt);
      dirty = true;
      if (Math.abs(walking.target - x) < 0.5) {
        const done = walking, word = moveWord;
        walking = null; moveWord = null; explicit = null;
        x = done.target;
        if (done.id != null) emit('arrived', { walkId: done.id, x, y });
        if (word) emit('done', { word });
        begin(0, true);
        ambient();
      }
    }
    updateAnimation(Math.min(dt, 3600) * 1000);
    if (draw && dirty) paint();
  }
  function layout() {
    const { w, h } = size();
    const cy = y - h / 2;
    return {
      x, y, facing, mode: mode(), busy: dragging,
      moving: !!walking || dragging || airStart != null || (row !== 0 && row !== 9),
      pressing: !!press, cursor: dragging ? 'grabbing' : hover ? 'grab' : '',
      box: { x: x - w / 2, y: y - h, w, h },
      hit: [{ x, y: cy, r: w * 0.38 }],
      bubble: { x, y: Math.max(0, y - h + 8 * bounds.S) },
      side: { x, y: cy, reach: w / 2 },
    };
  }
  function walk(target, run = false, id = null) {
    if (disposed || dragging || !Number.isFinite(target)) return false;
    stopMoving('replaced');
    const limit = limits();
    const next = clamp(target, limit.minX, limit.maxX);
    if (Math.abs(next - x) < 0.5) {
      if (id != null) emit('arrived', { walkId: id, x, y });
      return true;
    }
    facing = next < x ? -1 : 1;
    walking = { target: next, run: !!run, id };
    begin(facing < 0 ? 2 : 1, true);
    return true;
  }
  function doWord(word) {
    if (disposed || dragging) return false;
    const value = String(word);
    if (value === 'move' || value === 'walk' || value === 'run' || value === '移动' || value === '轻移') {
      const limit = limits();
      let target = x + facing * 160 * bounds.S;
      if (target < limit.minX || target > limit.maxX) target = x - facing * 160 * bounds.S;
      const ok = walk(target, value === 'run');
      if (ok && walking) moveWord = value;
      else if (ok) emit('done', { word: value });
      return ok;
    }
    const next = WORD_ROWS[value];
    if (next == null) return false;
    stopMoving('action');
    looking = next === 9;
    begin(next, next === 0 || next === 9, next === 0 || next === 9 ? null : value);
    paint();
    return true;
  }
  function hit(point) {
    const area = layout();
    return area.hit.some((circle) => Math.hypot(point.x - circle.x, point.y - circle.y) <= circle.r);
  }
  function pointDirection(point) {
    const cy = y - size().h / 2;
    const angle = (Math.atan2(point.x - x, -(point.y - cy)) * 180 / Math.PI + 360) % 360;
    const next = Math.round(angle / 22.5) % 16;
    if (next !== direction) { direction = next; dirty = true; }
  }
  function pointer(type, point = {}) {
    if (disposed) return;
    const p = { x: finite(point.x, x), y: finite(point.y, y), t: finite(point.t, 0) };
    pointDirection(p);
    if (type === 'leave') { hover = false; dirty = true; return; }
    hover = hit(p);
    if (type === 'down' && hover) {
      press = { x: p.x, y: p.y, offsetX: x - p.x, offsetY: y - p.y };
      dirty = true;
    } else if (type === 'move' && press) {
      if (!dragging && Math.hypot(p.x - press.x, p.y - press.y) >= 5) {
        stopMoving('drag');
        dragging = true; explicit = null; airStart = null;
        if (codexPlaying) begin(0, true);
        emit('touch', { kind: 'grab', x, y });
      }
      if (dragging) {
        const limit = limits();
        x = clamp(p.x + press.offsetX, limit.minX, limit.maxX);
        y = clamp(p.y + press.offsetY, limit.minY, bounds.floorY);
        dirty = true;
      }
    } else if ((type === 'up' || type === 'cancel') && press) {
      const wasDrag = dragging;
      press = null; dragging = false;
      if (wasDrag) {
        emit('touch', { kind: 'drop', x, y });
        begin(0, true);
        ambient();
      } else if (type === 'up' && hover) {
        emit('touch', { kind: 'poke', x, y });
        doWord('greet');
      }
      dirty = true;
    }
  }
  function set(state = {}) {
    if (state.bounds) resize();
    if (Object.hasOwn(state, 'listening')) listening = !!state.listening;
    if (Object.hasOwn(state, 'thinking')) thinking = !!state.thinking;
    if (Object.hasOwn(state, 'status')) status = state.status || null;
    const previousState = codexState, previousTurn = codexTurnId;
    if (Object.hasOwn(state, 'codexTurnId')) codexTurnId = typeof state.codexTurnId === 'string' ? state.codexTurnId : '';
    if (Object.hasOwn(state, 'codexState')) {
      codexState = codexMode(state.codexState);
    }
    if (codexState !== previousState || codexTurnId !== previousTurn) {
      codexRevision++;
      pausedCodex = null;
    }
    if (state.still || state.dialogOpen) stopMoving('dialog');
    ambient();
  }
  function place(nextX, nextFacing = facing, nextY = y) {
    if (disposed) return;
    stopMoving('placed');
    const limit = limits();
    x = clamp(finite(nextX, x), limit.minX, limit.maxX);
    y = clamp(finite(nextY, y), limit.minY, bounds.floorY);
    facing = nextFacing === -1 ? -1 : 1;
    airStart = null;
    dirty = true;
    paint();
  }
  function drop(point = {}) {
    if (disposed) return;
    if (press) pointer('up', point);
    else {
      place(finite(point.x, x), facing, finite(point.y, y));
      emit('touch', { kind: 'drop', x, y });
    }
  }

  function motionChanged(event) {
    reducedMotion = !!event.matches;
    playedCodexRevision = -1;
    dirty = true;
    ambient();
    paint();
  }
  motionQuery?.addEventListener?.('change', motionChanged);
  resize();
  if (host.start?.enter === 'drop' && !Number.isFinite(host.start?.y)) {
    const target = y;
    y = Math.min(y, size().h + 4);
    airStart = { target };
  }
  paint();
  return {
    words: [...PUBLIC_WORDS, ...Object.keys(WORD_ROWS), 'walk', 'run'],
    step, layout, resize, do: doWord, walk, pointer, drop, place, set,
    stopWalk(id) {
      if (!walking || walking.id !== id) return;
      stopMoving('stopped'); explicit = null; begin(0, true); ambient();
    },
    shift(dx, dy) {
      place(x + finite(dx, 0), facing, y + finite(dy, 0));
    },
    move(args, id) {
      const to = args?.to;
      let target = typeof to === 'number' ? to : to === 'left' ? 0 : to === 'right' ? bounds.W : to === 'center' ? bounds.W / 2 : NaN;
      if (typeof to === 'number' && to >= 0 && to <= 1) target = to * bounds.W;
      return walk(target, !!args?.run, id);
    },
    cue(kind) {
      if (kind === 'error' || kind === 'failed') doWord('error');
      else if (kind === 'done' || kind === 'success' || kind === 'cheer' || kind === 'heard') doWord('greet');
      else if (kind === 'perk') doWord('inspect');
    },
    talk() {
      if (!explicit && !dragging && !walking && !thinking && !listening) doWord('greet');
    },
    setScheme() {},
    snapshot() { return { row, frame, rounds, loop, direction, thinking, listening, status, codexState, codexTurnId, codexPlaying, pausedCodex: pausedCodex ? { ...pausedCodex } : null, reducedMotion, x, y, mode: mode() }; },
    get z() { return '#6fd8ed'; },
    dispose() {
      if (disposed) return;
      disposed = true; press = null; walking = null;
      motionQuery?.removeEventListener?.('change', motionChanged);
      sprite.remove();
    },
  };
}
