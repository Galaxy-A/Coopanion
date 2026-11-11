// SPDX-License-Identifier: AGPL-3.0-or-later
// Read-only adapter for the desktop rollout format shipped with Codex 0.167.
import { open, readdir, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { watch } from 'node:fs';

const TAIL_BYTES = 8 * 1024 * 1024;
const MAX_LINE = 4 * 1024 * 1024;
const INDEX_BYTES = 1024 * 1024;
const POLL_MS = 400;
const MAX_THREADS = 32;
const TERMINAL = new Set(['completed', 'interrupted', 'failed']);
const WAITING_TOOLS = new Set([
  'request_user_input', 'request_permissions', 'request_environment_input',
  'request_onboarding_input', 'request_option_picker',
]);
const MESSAGE_PHASES = { commentary: 0, partial_answer: 1, final_answer: 2 };
const LABELS = {
  working: '正在运行', waiting: '需要输入', completed: '就绪',
  interrupted: '已中断', failed: '已拦截', stale: '同步已过期', disconnected: '连接已断开',
};
const ACTIVITY = {
  working: 'running', waiting: 'waiting', completed: 'review', failed: 'failed',
  interrupted: 'idle', stale: 'unknown', disconnected: 'unknown',
};
const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 20);
const compactText = (text, limit) => typeof text === 'string'
  ? text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit)
  : '';
function summarizeMessage(text) {
  const plain = compactText(text
    .replace(/^ {0,3}(?:`{3,}|~{3,})[^\n]*(?:\n|$)/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/^ {0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/^ {0,3}(?:[-*_]\s*){3,}$/gm, '')
    .replace(/`+([^`\n]+)`+/g, '$1')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2'),
  Number.MAX_SAFE_INTEGER);
  return { summary: plain.slice(0, 280), truncated: plain.length > 280 };
}
const dateDirectory = (date) => [
  date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
];
const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };

export async function attachCodexBridge({ send }) {
  const sessionsRoot = process.env.GHOST_CODEX_SESSIONS_ROOT
    || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
  const receiptDir = join(process.env.CORTICO_COMPANION_DATA, 'codex-bridge');
  const bridgeId = randomUUID();
  const attachedAt = Date.now();
  const sessions = new Map();
  const threadNames = new Map();
  const ignored = new Set();
  const unsupportedFiles = new Set();
  const changedFiles = new Set();
  let sequence = 0, stopped = false, polling = false, discoveredAt = 0;
  let lastWire = '', lastReceipt = '', lastReceiptAt = 0, discoveryError = null;
  let snapshot = { t: 'codex', bridgeId, sequence, source: 'desktop-transcript', sessions: [], session: null };
  let messages = 0, malformed = 0;
  let indexSignature = '';
  let inventoried = false, watcher = null;
  try {
    watcher = watch(sessionsRoot, { recursive: true }, (_event, filename) => {
      if (filename && /^\d{4}[\\/]\d{2}[\\/]\d{2}[\\/]rollout-[^\\/]+\.jsonl$/i.test(String(filename))) {
        const file = join(sessionsRoot, String(filename));
        ignored.delete(file);
        changedFiles.add(file);
      }
    });
    watcher.on('error', (error) => { discoveryError = error.code || 'watch-failed'; });
    watcher.unref();
  } catch (error) { discoveryError = error.code || 'watch-failed'; }

  function consume(session, record, bootstrap) {
    if (!record || typeof record !== 'object') return;
    const p = record.payload;
    if (!p || typeof p !== 'object') return;
    const time = Date.parse(record.timestamp);
    if (!Number.isFinite(time)) return;
    const live = !bootstrap || time >= attachedAt;
    session.seenAt = Math.max(session.seenAt, time);
    if (record.type === 'event_msg') {
      if (p.type === 'task_started' && typeof p.turn_id === 'string') {
        if (p.turn_id === session.turnId || time <= session.startedAt) return;
        session.turnId = p.turn_id;
        session.startedAt = time;
        session.changedAt = time;
        session.state = 'working';
        session.message = null;
        session.messages = [];
        session.prompt = '';
        session.live = live;
        session.calls.clear();
      } else if (p.turn_id && p.turn_id !== session.turnId) {
        return;
      } else if (session.turnId && !TERMINAL.has(session.state)) {
        const end = {
          task_complete: 'completed', turn_aborted: 'interrupted',
          task_interrupted: 'interrupted', task_failed: 'failed', turn_failed: 'failed',
        }[p.type];
        if (end && p.turn_id === session.turnId) {
          session.state = end;
          session.changedAt = time;
          if (live) session.live = true;
          session.calls.clear();
        }
      }
      return;
    }
    if (record.type === 'turn_context' && !session.turnId && typeof p.turn_id === 'string') {
      session.turnId = p.turn_id;
      session.startedAt = time;
      session.changedAt = time;
      session.state = 'working';
      session.live = live;
    }
    if (record.type !== 'response_item' || !session.turnId) return;
    // This metadata was checked against the running desktop build. Unscoped items fail closed.
    if (p.internal_chat_message_metadata_passthrough?.turn_id !== session.turnId) return;
    if (time < session.startedAt) return;
    if (TERMINAL.has(session.state)
      && !(session.state === 'completed' && p.type === 'message' && p.phase === 'final_answer')) return;
    // Only this build's scoped input_text is eligible; injected context is rejected whole.
    if (p.type === 'message' && p.role === 'user') {
      if (!session.prompt) {
        const prompt = Array.isArray(p.content) ? p.content
          .filter((c) => c?.type === 'input_text' && typeof c.text === 'string')
          .map((c) => c.text).join('\n').trim() : '';
        if (prompt && !/<(?:environment_context|instructions|skills_instructions|skills?|system|developer|permissions|collaboration_mode)\b/i.test(prompt)) {
          session.prompt = compactText(prompt, 240);
          if (live) session.live = true;
        }
      }
      return;
    }
    // Never inspect reasoning, tool arguments/results, system/developer text, or compaction.
    if (p.type === 'function_call' && typeof p.call_id === 'string') {
      session.calls.set(p.call_id, WAITING_TOOLS.has(p.name) ? 'waiting' : 'working');
      session.state = [...session.calls.values()].includes('waiting') ? 'waiting' : 'working';
      session.changedAt = time;
      if (live) session.live = true;
    } else if (p.type === 'function_call_output' && typeof p.call_id === 'string') {
      if (!session.calls.has(p.call_id)) return;
      session.calls.delete(p.call_id);
      session.state = [...session.calls.values()].includes('waiting') ? 'waiting' : 'working';
      session.changedAt = time;
      if (live) session.live = true;
    } else if (p.type === 'message' && p.role === 'assistant'
      && ['commentary', 'partial_answer', 'final_answer'].includes(p.phase)) {
      const text = Array.isArray(p.content) ? p.content
        .filter((c) => c && ['output_text', 'text'].includes(c.type) && typeof c.text === 'string')
        .map((c) => c.text).join('\n').trim() : '';
      if (!text) return;
      if (session.message && (time < session.message.at
        || (time === session.message.at && MESSAGE_PHASES[p.phase] < MESSAGE_PHASES[session.message.phase]))) return;
      const id = `${session.turnId}:${p.phase}:${time}:${digest(text)}`;
      if (session.message?.id === id) return;
      // Keep the latest card content even after it was read; bootstrap is not a new notification.
      const summary = summarizeMessage(text);
      session.message = { id, text: summary.summary, ...summary, phase: p.phase, at: time,
        expiresAt: Number.MAX_SAFE_INTEGER };
      session.messages = [session.message];
      if (live) session.live = true;
      messages++;
    }
  }

  async function refreshThreadNames() {
    const acceptedIds = new Set([...sessions.values()].map((session) => session.id));
    const file = join(dirname(sessionsRoot), 'session_index.jsonl');
    let handle;
    try {
      handle = await open(file, 'r');
      const info = await handle.stat();
      const signature = `${info.mtimeMs}:${info.size}:${[...acceptedIds].sort().join(',')}`;
      if (signature === indexSignature) return;
      const offset = Math.max(0, info.size - INDEX_BYTES);
      const buffer = Buffer.alloc(Math.min(info.size, INDEX_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      const text = buffer.subarray(0, bytesRead).toString('utf8');
      const lines = text.split('\n');
      if (offset) lines.shift();
      threadNames.clear();
      for (const line of lines) {
        const row = parse(line);
        if (!acceptedIds.has(row?.id)) continue;
        const title = compactText(row.thread_name, 160);
        if (title) threadNames.set(row.id, title);
      }
      indexSignature = signature;
    } catch {
      // The optional title index can be absent or concurrently rewritten.
      threadNames.clear();
      indexSignature = '';
    } finally { await handle?.close(); }
  }

  async function discover() {
    const candidates = [];
    const files = new Set(changedFiles);
    for (const file of changedFiles) ignored.delete(file);
    changedFiles.clear();
    let readable = false;
    // An old thread may be resumed in its original dated directory.
    if (!inventoried) {
      try {
        for (const name of await readdir(sessionsRoot, { recursive: true })) {
          if (/^\d{4}[\\/]\d{2}[\\/]\d{2}[\\/]rollout-[^\\/]+\.jsonl$/i.test(name)) files.add(join(sessionsRoot, name));
        }
        inventoried = true;
      } catch (error) { discoveryError = error.code || 'inventory-failed'; }
    }
    for (let days = 0; days < 3; days++) {
      const date = new Date();
      date.setDate(date.getDate() - days);
      const dir = join(sessionsRoot, ...dateDirectory(date).map(String));
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); readable = true; }
      catch (error) { if (error.code !== 'ENOENT') discoveryError = error.code || 'read-failed'; continue; }
      for (const entry of entries) {
        if (!entry.isFile() || !/^rollout-.*[0-9a-f-]{36}\.jsonl$/i.test(entry.name)) continue;
        files.add(join(dir, entry.name));
      }
    }
    for (const file of files) {
      if (ignored.has(file) || (sessions.has(file) && sessions.get(file).readError !== 'rollout-replaced')) continue;
      try {
        const info = await stat(file);
        if (info.isFile() && Date.now() - info.mtimeMs < 24 * 60 * 60_000) candidates.push({ file, info });
      } catch { /* A session can be archived between discovery and reading. */ }
    }
    if (readable) discoveryError = null;
    candidates.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    for (const { file, info } of candidates.slice(0, 48)) {
      if (sessions.has(file) && sessions.get(file).readError !== 'rollout-replaced') continue;
      const handle = await open(file, 'r');
      let meta, header;
      try {
        const head = Buffer.alloc(64 * 1024);
        const { bytesRead } = await handle.read(head, 0, head.length, 0);
        header = head.subarray(0, bytesRead).toString('utf8').split('\n')[0];
        meta = parse(header)?.payload;
      } finally { await handle.close(); }
      if (meta?.originator !== 'codex_work_desktop' || typeof meta.source !== 'string'
        || !/^[0-9a-f-]{36}$/i.test(meta.id || '') || typeof meta.cwd !== 'string') {
        ignored.add(file);
        sessions.delete(file);
        continue;
      }
      if (!/^0\.167\./.test(meta.cli_version || '')) {
        unsupportedFiles.add(file);
        ignored.add(file);
        sessions.delete(file);
        continue;
      }
      unsupportedFiles.delete(file);
      sessions.set(file, {
        id: meta.id, cwd: meta.cwd, version: meta.cli_version, offset: Math.max(0, info.size - TAIL_BYTES),
        title: compactText(meta.title, 100),
        headerHash: digest(header), identity: `${info.dev}:${info.ino}:${info.birthtimeMs}`,
        checkpoint: null,
        skipFirst: info.size > TAIL_BYTES, pending: Buffer.alloc(0), bootstrap: true,
        turnId: null, state: 'disconnected', startedAt: 0, changedAt: 0, seenAt: 0,
        prompt: '', live: false,
        message: null, messages: [], calls: new Map(), unavailable: false,
      });
    }
    if (ignored.size > 1000) ignored.clear();
    if (sessions.size > 64) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
      for (const [file] of oldest.slice(0, sessions.size - 64)) sessions.delete(file);
    }
  }

  async function readSession(file, session) {
    let handle;
    try {
      handle = await open(file, 'r');
      const info = await handle.stat();
      if (`${info.dev}:${info.ino}:${info.birthtimeMs}` !== session.identity) {
        throw Object.assign(new Error('rollout replaced'), { code: 'rollout-replaced' });
      }
      const head = Buffer.alloc(Math.min(64 * 1024, info.size));
      const headerRead = await handle.read(head, 0, head.length, 0);
      const header = head.subarray(0, headerRead.bytesRead).toString('utf8').split('\n')[0];
      if (digest(header) !== session.headerHash) {
        throw Object.assign(new Error('rollout header changed'), { code: 'rollout-replaced' });
      }
      session.unavailable = false;
      session.readError = null;
      let changedCheckpoint = false;
      if (session.checkpoint && info.size >= session.offset) {
        const check = Buffer.alloc(session.checkpoint.length);
        const read = await handle.read(check, 0, check.length, session.offset - check.length);
        changedCheckpoint = read.bytesRead !== check.length || !check.equals(session.checkpoint);
      }
      if (info.size < session.offset || changedCheckpoint) {
        // A replaced/truncated rollout must not inherit a previous turn's state.
        session.offset = 0;
        session.pending = Buffer.alloc(0);
        session.skipFirst = false;
        session.bootstrap = true;
        session.turnId = null;
        session.startedAt = 0;
        session.changedAt = 0;
        session.seenAt = 0;
        session.state = 'disconnected';
        session.message = null;
        session.messages = [];
        session.prompt = '';
        session.live = false;
        session.checkpoint = null;
        session.calls.clear();
      }
      const length = Math.min(info.size - session.offset, TAIL_BYTES);
      if (!length) return;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, session.offset);
      session.offset += bytesRead;
      session.checkpoint = Buffer.from(buffer.subarray(Math.max(0, bytesRead - 512), bytesRead));
      const bytes = Buffer.concat([session.pending, buffer.subarray(0, bytesRead)]);
      let start = 0, end;
      while ((end = bytes.indexOf(10, start)) !== -1) {
        if (session.skipFirst) session.skipFirst = false;
        else if (end - start <= MAX_LINE) {
          const record = parse(bytes.subarray(start, end).toString('utf8'));
          if (record) consume(session, record, session.bootstrap);
          else malformed++;
        }
        start = end + 1;
      }
      session.pending = Buffer.from(bytes.subarray(start));
      if (session.pending.length > MAX_LINE) {
        session.pending = Buffer.alloc(0);
        session.skipFirst = true;
        malformed++;
      }
      if (session.offset >= info.size) session.bootstrap = false;
    } catch (error) {
      session.unavailable = true;
      session.readError = error.code || 'read-failed';
      if (session.readError === 'rollout-replaced') changedFiles.add(file);
    } finally { await handle?.close(); }
  }

  function stateOf(session) {
    if (session.unavailable) return 'disconnected';
    return session.state;
  }

  function status() {
    return {
      enabled: true, source: 'desktop-transcript', format: 'codex-0.167',
      bridgeId, sequence, messages, malformed, unsupported: unsupportedFiles.size, discoveryError,
      selectedSession: snapshot.session?.id || null,
      sessions: orderedSessions().map((s) => ({
        id: s.id, cwd: s.cwd, version: s.version, turnId: s.turnId,
        state: stateOf(s), activity: ACTIVITY[stateOf(s)] || 'unknown',
        live: s.live, lastActivityAt: new Date(s.seenAt).toISOString(),
      })),
    };
  }

  function orderedSessions() {
    const latest = new Map();
    for (const s of sessions.values()) {
      if (!s.turnId) continue;
      const old = latest.get(s.id);
      if (!old || s.startedAt > old.startedAt || (s.startedAt === old.startedAt && s.seenAt > old.seenAt)) latest.set(s.id, s);
    }
    return [...latest.values()].sort((a, b) =>
      (b.startedAt || b.seenAt) - (a.startedAt || a.seenAt) || b.id.localeCompare(a.id));
  }

  function wireSession(session) {
    const state = stateOf(session);
    const project = basename(session.cwd.replace(/\\/g, '/')) || session.cwd;
    return {
      id: session.id, cwd: session.cwd, project, title: threadNames.get(session.id) || session.title || project,
      turnId: session.turnId, state, activity: ACTIVITY[state] || 'unknown', label: LABELS[state],
      startedAt: session.startedAt, changedAt: session.changedAt, lastActivityAt: session.seenAt,
      sortAtMs: session.startedAt || session.seenAt,
      live: session.live, fresh: Date.now() - session.changedAt < 60_000,
      prompt: session.prompt, message: session.message, messages: session.messages,
    };
  }

  async function publish() {
    const ordered = orderedSessions();
    const active = (session) => ['working', 'waiting'].includes(stateOf(session));
    // The cap retains ongoing work; tool/message updates do not change the turn's card order.
    const retained = [...ordered.filter(active), ...ordered.filter((s) => !active(s))]
      .slice(0, MAX_THREADS)
      .sort((a, b) =>
        (b.startedAt || b.seenAt) - (a.startedAt || a.seenAt) || b.id.localeCompare(a.id));
    const visible = retained.map(wireSession);
    const selected = visible[0] || null;
    const wire = {
      t: 'codex', bridgeId, source: 'desktop-transcript',
      warning: unsupportedFiles.size ? 'unsupported-version' : discoveryError,
      activeOthers: visible.filter((s) => s.id !== selected?.id
        && ['running', 'waiting', 'failed'].includes(s.activity)).length,
      sessions: visible,
      session: selected,
    };
    const key = JSON.stringify(wire);
    if (key !== lastWire) {
      lastWire = key;
      snapshot = { ...wire, sequence: ++sequence };
      send(snapshot);
    }
    const receipt = JSON.stringify(status(), null, 2);
    if (receipt !== lastReceipt && Date.now() - lastReceiptAt > 2000) {
      await mkdir(receiptDir, { recursive: true });
      const file = join(receiptDir, 'status.json');
      await writeFile(`${file}.pending`, receipt, { encoding: 'utf8', mode: 0o600 });
      await rename(`${file}.pending`, file);
      lastReceipt = receipt;
      lastReceiptAt = Date.now();
    }
  }

  async function tick() {
    if (stopped || polling) return;
    polling = true;
    try {
      if (Date.now() - discoveredAt > 3000) {
        discoveredAt = Date.now();
        await discover();
        await refreshThreadNames();
      }
      for (const [file, session] of sessions) await readSession(file, session);
      await publish();
    } catch (error) {
      discoveryError = error.code || 'adapter-failed';
    } finally { polling = false; }
  }
  await tick();
  const timer = setInterval(() => { void tick(); }, POLL_MS);
  timer.unref();
  return {
    snapshot: () => snapshot,
    status,
    stop() { stopped = true; clearInterval(timer); watcher?.close(); },
  };
}
