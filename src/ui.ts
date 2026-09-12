/**
 * Single-file operator console served at GET /. It talks to this same origin
 * with the API token the operator pastes in the browser; nothing here embeds
 * secrets, so the page itself is public. Keep this file free of backticks and
 * "${" so the raw template stays literal.
 */
export const ui = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Console</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f6f7f9; --panel: #ffffff; --line: #e3e6ea; --text: #1c1f24; --muted: #6b7280;
  --accent: #2563eb; --accent-text: #ffffff; --ok: #16a34a; --warn: #d97706; --bad: #dc2626;
  --user: #eef2ff; --tool: #f1f5f9; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f1115; --panel: #171a21; --line: #2a2f3a; --text: #e6e8eb; --muted: #9aa3b2; --accent: #3b82f6; --user: #1e2436; --tool: #1c2230; }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text); background: var(--bg); display: grid; grid-template-rows: auto 1fr; }
header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--line); }
header h1 { font-size: 15px; margin: 0; font-weight: 600; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); display: inline-block; margin-right: 6px; }
.dot.ok { background: var(--ok); } .dot.bad { background: var(--bad); }
.spacer { flex: 1; }
button { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
button:hover { border-color: var(--muted); }
button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
button:disabled { opacity: .5; cursor: default; }
input, textarea, select { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; width: 100%; }
textarea { resize: vertical; min-height: 88px; }
label { display: block; font-size: 12px; color: var(--muted); margin: 10px 0 4px; }
.layout { display: grid; grid-template-columns: 280px 1fr; min-height: 0; }
aside { border-right: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; min-height: 0; }
aside .top { padding: 12px; border-bottom: 1px solid var(--line); display: grid; gap: 8px; }
aside .top form { display: flex; gap: 6px; }
.sessions { overflow: auto; flex: 1; }
.session { padding: 10px 12px; border-bottom: 1px solid var(--line); cursor: pointer; display: grid; gap: 2px; }
.session:hover { background: var(--bg); }
.session.active { background: var(--user); }
.session .repo { font-weight: 600; font-size: 13px; }
.session .meta { color: var(--muted); font-size: 12px; display: flex; gap: 8px; }
.session .prompt { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge { font-size: 11px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.badge.running { color: var(--accent); border-color: var(--accent); }
.badge.completed { color: var(--ok); border-color: var(--ok); }
.badge.failed, .badge.disconnected { color: var(--bad); border-color: var(--bad); }
main { display: flex; flex-direction: column; min-height: 0; }
.view { display: none; flex: 1; min-height: 0; flex-direction: column; }
.view.active { display: flex; }
.center { max-width: 760px; width: 100%; margin: 0 auto; padding: 24px 16px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.actions { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
.hint { color: var(--muted); font-size: 12px; }
.error { color: var(--bad); font-size: 13px; }
.session-head { padding: 12px 16px; background: var(--panel); border-bottom: 1px solid var(--line); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.session-head .title { font-weight: 600; }
.session-head code { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.transcript { flex: 1; overflow: auto; padding: 16px; display: grid; gap: 14px; align-content: start; }
.turn { display: grid; gap: 8px; max-width: 900px; width: 100%; }
.bubble { border-radius: 10px; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; }
.bubble.user { background: var(--user); justify-self: end; max-width: 80%; }
.bubble.assistant { background: var(--panel); border: 1px solid var(--line); }
.bubble.final { border-color: var(--ok); }
.bubble.failed { border-color: var(--bad); }
.status-line { color: var(--muted); font-size: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.tools { display: flex; gap: 6px; flex-wrap: wrap; }
.tool { font-family: var(--mono); font-size: 11px; background: var(--tool); border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; }
.tool.running { border-color: var(--accent); } .tool.error { border-color: var(--bad); } .tool.completed { color: var(--muted); }
.diag { font-family: var(--mono); font-size: 12px; color: var(--muted); white-space: pre-wrap; }
.composer { padding: 12px 16px; background: var(--panel); border-top: 1px solid var(--line); display: grid; gap: 8px; }
.composer textarea { min-height: 64px; }
dialog { border: 1px solid var(--line); border-radius: 12px; background: var(--panel); color: var(--text); padding: 20px; width: min(520px, 92vw); }
dialog::backdrop { background: rgba(0,0,0,.4); }
dialog h2 { margin: 0 0 4px; font-size: 16px; }
.inspect { font-family: var(--mono); font-size: 12px; white-space: pre-wrap; background: var(--tool); border-radius: 8px; padding: 10px; max-height: 50vh; overflow: auto; }
#toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--text); color: var(--bg); padding: 8px 14px; border-radius: 8px; font-size: 13px; opacity: 0; transition: opacity .2s; pointer-events: none; }
#toast.show { opacity: 1; }
@media (max-width: 760px) { .layout { grid-template-columns: 1fr; } aside { display: none; } aside.open { display: flex; position: fixed; inset: 49px 0 0 0; z-index: 5; } .row { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <button id="menu" title="Sessions">☰</button>
  <h1>Agent Console</h1>
  <span class="hint"><span class="dot" id="health-dot"></span><span id="health-text">checking…</span></span>
  <span class="spacer"></span>
  <button id="open-settings">Settings</button>
</header>
<div class="layout">
  <aside id="sidebar">
    <div class="top">
      <button class="primary" id="new-session">+ New session</button>
      <form id="open-form"><input id="open-id" placeholder="Open session by ID" autocomplete="off"><button type="submit">Open</button></form>
    </div>
    <div class="sessions" id="sessions"></div>
  </aside>
  <main>
    <section class="view active" id="view-new">
      <div class="center">
        <div class="card">
          <h2 style="margin:0 0 4px;font-size:16px">Start a session</h2>
          <p class="hint" style="margin:0">The agent clones the repository, works on an agent branch, and streams progress here. Commands are accepted immediately; the turn itself can take minutes.</p>
          <form id="create-form">
            <div class="row">
              <div><label for="repository">Repository</label><input id="repository" placeholder="owner/repo" required></div>
              <div><label for="model">OpenRouter model</label><input id="model" placeholder="anthropic/claude-sonnet-4.5" required></div>
            </div>
            <label for="prompt">Prompt</label>
            <textarea id="prompt" placeholder="Explain the architecture. Do not modify files or push." required></textarea>
            <div class="actions"><button class="primary" type="submit" id="create-btn">Run</button><span class="error" id="create-error"></span></div>
          </form>
        </div>
      </div>
    </section>
    <section class="view" id="view-session">
      <div class="session-head">
        <span class="title" id="s-repo"></span>
        <span class="badge" id="s-model"></span>
        <code id="s-id"></code>
        <span class="spacer"></span>
        <button id="copy-id">Copy ID</button>
        <button id="inspect">Inspect</button>
        <button id="forget">Remove</button>
      </div>
      <div class="transcript" id="transcript"></div>
      <div class="composer">
        <textarea id="followup" placeholder="Follow-up prompt… (⌘/Ctrl+Enter to send)"></textarea>
        <div class="actions" style="margin:0"><button class="primary" id="send">Send</button><span class="error" id="send-error"></span></div>
      </div>
    </section>
  </main>
</div>
<dialog id="settings">
  <h2>Settings</h2>
  <p class="hint" style="margin:0">Stored in this browser only. The API token is sent as a Bearer header to this origin.</p>
  <label for="token">API token</label><input id="token" type="password" autocomplete="off">
  <div class="row">
    <div><label for="default-repository">Default repository</label><input id="default-repository" placeholder="owner/repo"></div>
    <div><label for="default-model">Default model</label><input id="default-model" placeholder="anthropic/claude-sonnet-4.5"></div>
  </div>
  <div class="actions"><button class="primary" id="save-settings">Save</button><button id="clear-token">Forget token</button><button id="close-settings">Close</button></div>
  <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
  <h2>GitHub issue model rule</h2>
  <p class="hint" style="margin:0">Overrides the default model for issues opened in one repository.</p>
  <form id="rule-form">
    <div class="row">
      <div><label for="rule-repository">Repository</label><input id="rule-repository" placeholder="owner/repo" required></div>
      <div><label for="rule-model">Model</label><input id="rule-model" placeholder="anthropic/claude-sonnet-4.5" required></div>
    </div>
    <div class="actions"><button type="submit">Set rule</button><span class="hint" id="rule-status"></span></div>
  </form>
</dialog>
<dialog id="inspect-dialog">
  <h2>Stored session state</h2>
  <div class="inspect" id="inspect-body">Loading…</div>
  <div class="actions"><button id="close-inspect">Close</button></div>
</dialog>
<div id="toast"></div>
<script>
(function () {
  'use strict';
  var KEY = 'agent-console';
  var $ = function (id) { return document.getElementById(id); };
  var state = load();
  var current = null;
  var active = {}; // sessionId -> true while a stream is attached in this tab

  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return normalize(JSON.parse(raw)); } catch (e) {}
    return normalize({});
  }
  function normalize(s) {
    return { token: s.token || '', repository: s.repository || '', model: s.model || '', order: s.order || [], sessions: s.sessions || {} };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast('Could not save to browser storage'); } }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 2500); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(ts) { var d = new Date(ts); return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function headers(extra) {
    var h = { 'content-type': 'application/json' };
    if (state.token) h.authorization = 'Bearer ' + state.token;
    for (var k in (extra || {})) h[k] = extra[k];
    return h;
  }
  async function call(method, path, body) {
    var res = await fetch(path, { method: method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  // ---------- SSE ----------
  async function readEvents(body, onFrame) {
    var reader = body.getReader(), dec = new TextDecoder(), buf = '', data = [], id = '', event = '';
    while (true) {
      var chunk = await reader.read();
      buf += chunk.done ? dec.decode() : dec.decode(chunk.value, { stream: true });
      var nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        var line = buf.slice(0, nl).replace(/\r$/, ''); buf = buf.slice(nl + 1);
        if (!line) {
          if (data.length) { var stop = onFrame({ id: id, event: event, data: data.join('\n') }); if (stop) { try { await reader.cancel(); } catch (e) {} return true; } }
          data = []; event = '';
        } else if (line.charAt(0) === ':') { /* keep-alive */ }
        else if (line.indexOf('data:') === 0) data.push(line.slice(5).replace(/^ /, ''));
        else if (line.indexOf('id:') === 0) id = line.slice(3).replace(/^ /, '');
        else if (line.indexOf('event:') === 0) event = line.slice(6).replace(/^ /, '');
      }
      if (chunk.done) return false;
    }
  }
  // Streams one request until its terminal event; resumes with Last-Event-ID on interruption.
  async function streamRequest(url, onEvent, onGiveUp) {
    var lastId = '';
    for (var attempt = 0; attempt < 6; attempt++) {
      try {
        var res = await fetch(url, { headers: headers(lastId ? { 'last-event-id': lastId } : {}) });
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        var terminal = await readEvents(res.body, function (frame) {
          if (frame.id) lastId = frame.id;
          var payload; try { payload = JSON.parse(frame.data); } catch (e) { return false; }
          return onEvent(payload) === true;
        });
        if (terminal) return true;
      } catch (e) { if (attempt === 5) { onGiveUp(e); return false; } }
      await new Promise(function (r) { setTimeout(r, 1000 * (attempt + 1)); });
    }
    onGiveUp(new Error('Stream ended without a terminal event'));
    return false;
  }

  // ---------- Sessions ----------
  function session(id) { return state.sessions[id]; }
  function upsertSession(s) {
    if (!state.sessions[s.id]) state.order.unshift(s.id);
    state.sessions[s.id] = Object.assign(state.sessions[s.id] || { turns: [] }, s);
    save(); renderSidebar();
  }
  function lastStatus(s) { var t = s.turns[s.turns.length - 1]; return t ? t.status : 'idle'; }
  function renderSidebar() {
    var el = $('sessions'); el.innerHTML = '';
    if (!state.order.length) { el.innerHTML = '<div class="session hint">No sessions yet.</div>'; return; }
    state.order.forEach(function (id) {
      var s = session(id); if (!s) return;
      var d = document.createElement('div');
      d.className = 'session' + (current === id ? ' active' : '');
      var first = s.turns[0] ? s.turns[0].prompt : (s.source === 'opened' ? 'Opened by ID' : '');
      d.innerHTML = '<div class="repo">' + esc(s.repository || 'unknown repository') + '</div>' +
        '<div class="meta"><span class="badge ' + esc(lastStatus(s)) + '">' + esc(lastStatus(s)) + '</span><span>' + esc(s.createdAt ? when(s.createdAt) : '') + '</span></div>' +
        '<div class="prompt">' + esc(first) + '</div>';
      d.onclick = function () { show(id); $('sidebar').classList.remove('open'); };
      el.appendChild(d);
    });
  }
  function showNew() {
    current = null;
    $('view-new').classList.add('active'); $('view-session').classList.remove('active');
    if (!$('repository').value) $('repository').value = state.repository;
    if (!$('model').value) $('model').value = state.model;
    renderSidebar();
  }
  function show(id) {
    var s = session(id); if (!s) return showNew();
    current = id;
    $('view-new').classList.remove('active'); $('view-session').classList.add('active');
    $('s-repo').textContent = s.repository || 'unknown repository';
    $('s-model').textContent = s.model || 'model unknown';
    $('s-id').textContent = s.id;
    $('send-error').textContent = '';
    renderTranscript(s);
    renderSidebar();
    s.turns.forEach(function (t) { if (t.status === 'running' && !active[id + ':' + t.messageId] && t.stream) attach(s, t); });
  }

  // ---------- Turns ----------
  function renderTranscript(s) {
    var el = $('transcript'); el.innerHTML = '';
    s.turns.forEach(function (t) { el.appendChild(turnElement(s, t)); });
    el.scrollTop = el.scrollHeight;
  }
  function turnElement(s, t) {
    var d = document.createElement('div'); d.className = 'turn'; d.id = 'turn-' + t.messageId;
    d.innerHTML = '<div class="bubble user">' + esc(t.prompt) + '</div>' +
      '<div class="status-line"></div><div class="tools"></div><div class="blocks"></div><div class="final"></div>';
    paintTurn(d, s, t);
    return d;
  }
  function phaseText(t) {
    if (t.status === 'running') {
      if (!t.phase) return 'Dispatched — waiting for the session to start';
      return { waiting_for_workspace: 'Waiting for the shared workspace lock', checkout: 'Checking out the repository', agent_starting: 'Starting the agent', working: 'Agent is working' }[t.phase] || t.phase;
    }
    if (t.status === 'disconnected') return 'Stream interrupted. The agent may still be running.';
    var took = t.finishedAt && t.startedAt ? ' in ' + Math.max(1, Math.round((t.finishedAt - t.startedAt) / 1000)) + 's' : '';
    return { completed: 'Turn finished' + took, failed: 'Turn failed' + took, ignored: 'Turn ignored' }[t.status] || t.status;
  }
  function paintTurn(d, s, t) {
    var status = d.querySelector('.status-line');
    var resume = t.status === 'disconnected' && t.stream ? ' <button data-resume="1">Reconnect</button>' : '';
    status.innerHTML = '<span class="badge ' + esc(t.status) + '">' + esc(t.status) + '</span><span>' + esc(phaseText(t)) + '</span>' + resume;
    var rb = status.querySelector('[data-resume]'); if (rb) rb.onclick = function () { t.status = 'running'; save(); paintTurn(d, s, t); attach(s, t); };
    var tools = d.querySelector('.tools'); tools.innerHTML = '';
    (t.tools || []).forEach(function (x) { tools.innerHTML += '<span class="tool ' + esc(x.status) + '">' + esc(x.tool) + ' · ' + esc(x.status) + '</span>'; });
    var blocks = d.querySelector('.blocks'); blocks.innerHTML = '';
    if (t.status !== 'completed') (t.blocks || []).forEach(function (b) { if (b.text) blocks.innerHTML += '<div class="bubble assistant" data-part="' + esc(b.partId) + '">' + esc(b.text) + '</div>'; });
    var fin = d.querySelector('.final'); fin.innerHTML = '';
    if (t.status === 'completed') fin.innerHTML = '<div class="bubble assistant final">' + esc(t.response || '(The agent completed without a summary. Inspect the session.)') + '</div>' + (t.branch ? '<div class="hint">Branch: <code>' + esc(t.branch) + '</code> — a push is only certain if the agent reports one.</div>' : '');
    if (t.status === 'failed') fin.innerHTML = '<div class="bubble assistant failed">' + esc(t.error || 'Run failed.') + '</div>' + (t.diagnostic ? '<div class="diag">' + esc(JSON.stringify(t.diagnostic, null, 2)) + '</div>' : '');
    if (t.status === 'ignored') fin.innerHTML = '<div class="bubble assistant failed">Ignored: ' + esc(t.reason || '') + '</div>';
  }
  function repaint(s, t) {
    if (current !== s.id) return;
    var el = $('transcript'), d = document.getElementById('turn-' + t.messageId);
    var stick = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (d) paintTurn(d, s, t); else el.appendChild(turnElement(s, t));
    if (stick) el.scrollTop = el.scrollHeight;
  }
  function applyEvent(s, t, p) {
    var d = p.data || {};
    switch (p.type) {
      case 'started': t.phase = t.phase || 'started'; break;
      case 'status': t.phase = d.phase; break;
      case 'text.delta': case 'text.replace': {
        t.phase = 'working';
        var b = null; for (var i = 0; i < t.blocks.length; i++) if (t.blocks[i].partId === d.partId) b = t.blocks[i];
        if (!b) { b = { partId: d.partId, text: '' }; t.blocks.push(b); }
        b.text = p.type === 'text.delta' ? b.text + (d.text || '') : (d.text || '');
        break;
      }
      case 'tool.status': {
        t.phase = 'working';
        var x = null; for (var j = 0; j < t.tools.length; j++) if (t.tools[j].partId === d.partId) x = t.tools[j];
        if (!x) t.tools.push({ partId: d.partId, tool: d.tool, status: d.status }); else x.status = d.status;
        break;
      }
      case 'completed': t.status = 'completed'; t.response = d.response; t.branch = d.branch; break;
      case 'failed': t.status = 'failed'; t.error = d.error; t.diagnostic = d.diagnostic || (d.code ? { code: d.code } : undefined); break;
      case 'ignored': t.status = 'ignored'; t.reason = d.reason; break;
      default: return false;
    }
    var terminal = t.status !== 'running';
    if (terminal && !t.finishedAt) t.finishedAt = Date.now();
    if (terminal || p.type === 'status' || p.type === 'tool.status') save(); else throttleSave();
    repaint(s, t); if (terminal) renderSidebar();
    return terminal;
  }
  var saveTimer = null;
  function throttleSave() { if (saveTimer) return; saveTimer = setTimeout(function () { saveTimer = null; save(); }, 500); }
  function attach(s, t) {
    var key = s.id + ':' + t.messageId; if (active[key]) return; active[key] = true;
    streamRequest(t.stream, function (p) { return applyEvent(s, t, p); }, function () { t.status = 'disconnected'; save(); repaint(s, t); renderSidebar(); })
      .then(function () { delete active[key]; });
  }
  function newTurn(prompt, accepted) {
    return { messageId: accepted.messageId, prompt: prompt, stream: accepted.stream, status: 'running', phase: '', blocks: [], tools: [], startedAt: Date.now() };
  }

  // ---------- Actions ----------
  $('create-form').onsubmit = async function (e) {
    e.preventDefault(); $('create-error').textContent = '';
    var body = { repository: $('repository').value.trim(), model: $('model').value.trim(), prompt: $('prompt').value };
    if (!state.token) { $('create-error').textContent = 'Set the API token in Settings first.'; return; }
    $('create-btn').disabled = true;
    try {
      var accepted = await call('POST', '/sessions', body);
      state.repository = body.repository; state.model = body.model;
      var s = { id: accepted.sessionId, repository: body.repository, model: body.model, createdAt: Date.now(), turns: [] };
      upsertSession(s); s = session(s.id);
      var t = newTurn(body.prompt, accepted); s.turns.push(t); save();
      $('prompt').value = '';
      show(s.id); attach(s, t);
    } catch (err) { $('create-error').textContent = err.message; }
    $('create-btn').disabled = false;
  };
  async function sendFollowup() {
    var s = session(current); if (!s) return;
    var prompt = $('followup').value; if (!prompt.trim()) return;
    $('send-error').textContent = ''; $('send').disabled = true;
    try {
      var accepted = await call('POST', '/sessions/messages', { sessionId: s.id, prompt: prompt });
      var t = newTurn(prompt, accepted); s.turns.push(t); save();
      $('followup').value = ''; repaint(s, t); attach(s, t); renderSidebar();
    } catch (err) { $('send-error').textContent = err.message; }
    $('send').disabled = false;
  }
  $('send').onclick = sendFollowup;
  $('followup').onkeydown = function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendFollowup(); };
  $('prompt').onkeydown = function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('create-form').requestSubmit(); };
  $('new-session').onclick = function () { showNew(); $('sidebar').classList.remove('open'); };
  $('menu').onclick = function () { $('sidebar').classList.toggle('open'); };
  $('copy-id').onclick = function () { navigator.clipboard.writeText(current).then(function () { toast('Session ID copied'); }, function () { toast(current); }); };
  $('forget').onclick = function () {
    if (!current || !confirm('Remove this session from the browser list? Server state is kept.')) return;
    delete state.sessions[current]; state.order = state.order.filter(function (x) { return x !== current; }); save(); showNew();
  };
  $('open-form').onsubmit = async function (e) {
    e.preventDefault();
    var id = $('open-id').value.trim(); if (!/^[a-zA-Z0-9_-]+$/.test(id)) { toast('Invalid session ID'); return; }
    if (!session(id)) upsertSession({ id: id, createdAt: Date.now(), source: 'opened', turns: [] });
    $('open-id').value = ''; show(id); $('sidebar').classList.remove('open');
    inspect(id, false);
  };
  async function inspect(id, open) {
    var s = session(id); if (!s) return;
    if (open) { $('inspect-body').textContent = 'Loading…'; $('inspect-dialog').showModal(); }
    try {
      var accepted = await call('POST', '/sessions/inspect', { sessionId: id });
      await streamRequest(accepted.stream, function (p) {
        if (p.type !== 'session') return false;
        var d = p.data;
        if (open) $('inspect-body').textContent = d ? JSON.stringify(d, null, 2) : 'Unknown session (no stored state on the server).';
        if (d) {
          if (d.repository) s.repository = d.repository; if (d.model) s.model = d.model;
          if (!s.turns.length && d.prompt) s.turns.push({ messageId: 'stored', prompt: d.prompt, status: d.status === 'running' ? 'disconnected' : d.status, phase: '', blocks: [], tools: [], response: d.response, error: d.status === 'failed' ? 'Run failed (from stored state).' : undefined, diagnostic: d.diagnostic, branch: 'agent/' + s.id });
          else if (d.status !== 'running') { var last = s.turns[s.turns.length - 1]; if (last && (last.status === 'running' || last.status === 'disconnected') && !active[id + ':' + last.messageId]) { last.status = d.status; last.response = d.response; last.diagnostic = d.diagnostic; last.branch = 'agent/' + s.id; if (d.status === 'failed') last.error = 'Run failed (from stored state).'; } }
          save(); if (current === id) show(id); else renderSidebar();
        } else if (open) { /* nothing stored */ }
        return true;
      }, function (err) { if (open) $('inspect-body').textContent = 'Inspection stream failed: ' + err.message; });
    } catch (err) { if (open) $('inspect-body').textContent = 'Inspection failed: ' + err.message; else toast('Inspection failed: ' + err.message); }
  }
  $('inspect').onclick = function () { inspect(current, true); };
  $('close-inspect').onclick = function () { $('inspect-dialog').close(); };

  // ---------- Settings ----------
  $('open-settings').onclick = function () {
    $('token').value = state.token; $('default-repository').value = state.repository; $('default-model').value = state.model;
    $('rule-status').textContent = ''; $('settings').showModal();
  };
  $('close-settings').onclick = function () { $('settings').close(); };
  $('save-settings').onclick = function () {
    state.token = $('token').value.trim(); state.repository = $('default-repository').value.trim(); state.model = $('default-model').value.trim(); save();
    if (!$('repository').value) $('repository').value = state.repository; if (!$('model').value) $('model').value = state.model;
    paintHealth(); toast('Saved'); $('settings').close();
  };
  $('clear-token').onclick = function () { state.token = ''; $('token').value = ''; save(); paintHealth(); toast('Token removed'); };
  $('rule-form').onsubmit = async function (e) {
    e.preventDefault(); $('rule-status').textContent = 'Applying…';
    try {
      var accepted = await call('PUT', '/github/issue-rules', { repository: $('rule-repository').value.trim(), model: $('rule-model').value.trim() });
      await streamRequest(accepted.stream, function (p) {
        if (p.type === 'configured') { $('rule-status').textContent = 'Rule set: ' + p.data.repository + ' → ' + p.data.model; return true; }
        if (p.type === 'failed') { $('rule-status').textContent = 'Failed: ' + (p.data && p.data.error); return true; }
        return false;
      }, function (err) { $('rule-status').textContent = 'Stream failed: ' + err.message; });
    } catch (err) { $('rule-status').textContent = err.message; }
  };

  // ---------- Boot ----------
  var online = null;
  function paintHealth() {
    $('health-dot').className = 'dot ' + (online === null ? '' : online ? 'ok' : 'bad');
    $('health-text').textContent = online === null ? 'checking…' : !online ? 'API unreachable' : state.token ? 'API online' : 'API online — set token in Settings';
  }
  fetch('/health').then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function () { online = true; paintHealth(); }, function () { online = false; paintHealth(); });
  renderSidebar();
  showNew();
  if (!state.token) $('open-settings').click();
})();
</script>
</body>
</html>
`;
