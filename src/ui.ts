/**
 * Single-file operator console served at GET /. It talks to this same origin
 * with the API token the operator pastes in the browser; nothing here embeds
 * secrets, so the page itself is public. Keep this file free of backticks and
 * "${" so the raw template stays literal (the markdown renderer below spells
 * the backtick as '\x60' for that reason). The CSP on this route forbids every
 * external resource, so fonts are system faces and icons are inline SVG.
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
  --bg: #f3f2ee; --bg-2: #eceae4; --panel: #ffffff; --panel-2: #f8f7f4;
  --line: #e4e2dc; --line-2: #cfccc3;
  --text: #1c1b18; --text-2: #5d5b55; --text-3: #75736c;
  --accent: #2d55d4; --accent-hover: #2446b6; --accent-soft: #e9eefb; --accent-text: #ffffff;
  --ok: #1e8a4e; --ok-soft: #e3f3e9; --warn: #a85e0c; --warn-soft: #fbeedb; --bad: #c42f2f; --bad-soft: #fbe7e7;
  --user: #eceef6; --code: #f1f0eb;
  --shadow-sm: 0 1px 2px rgba(28,27,24,.05);
  --shadow: 0 1px 2px rgba(28,27,24,.06), 0 12px 32px -16px rgba(28,27,24,.25);
  --shadow-lg: 0 2px 4px rgba(28,27,24,.08), 0 24px 64px -24px rgba(28,27,24,.45);
  --r: 10px; --r-sm: 7px;
  --sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --ease: cubic-bezier(.2, .7, .2, 1);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141517; --bg-2: #0f1012; --panel: #1b1d21; --panel-2: #212429;
    --line: #2c3036; --line-2: #3d4249;
    --text: #e9e8e3; --text-2: #a7a6a0; --text-3: #8a8983;
    --accent: #7c97f2; --accent-hover: #95abf5; --accent-soft: #232b45; --accent-text: #0e1327;
    --ok: #4ec27c; --ok-soft: #16301f; --warn: #e2a24f; --warn-soft: #34270f; --bad: #ef6b6b; --bad-soft: #3a1c1c;
    --user: #242833; --code: #16181c;
    --shadow-sm: 0 1px 2px rgba(0,0,0,.3);
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 12px 32px -16px rgba(0,0,0,.7);
    --shadow-lg: 0 2px 4px rgba(0,0,0,.5), 0 24px 64px -24px rgba(0,0,0,.9);
  }
}

* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { font: 14px/1.5 var(--sans); color: var(--text); background: var(--bg); display: grid; grid-template-rows: auto 1fr; -webkit-font-smoothing: antialiased; }
::selection { background: var(--accent-soft); color: var(--text); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
* { scrollbar-width: thin; scrollbar-color: var(--line-2) transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb { background: var(--line-2); border: 3px solid transparent; background-clip: padding-box; border-radius: 8px; }
svg.i { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
code, kbd, pre { font-family: var(--mono); }
.spacer { flex: 1; }
.hint { color: var(--text-2); font-size: 12.5px; }
.error { color: var(--bad); font-size: 13px; }
.error:empty { display: none; }

/* Buttons */
.btn { font: inherit; font-weight: 500; color: var(--text); background: var(--panel); border: 1px solid var(--line-2); border-radius: var(--r-sm); padding: 6px 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; line-height: 20px; white-space: nowrap; box-shadow: var(--shadow-sm); transition: background .15s var(--ease), border-color .15s var(--ease), color .15s var(--ease), transform .1s var(--ease); }
.btn:hover { background: var(--panel-2); border-color: var(--text-3); }
.btn:active { transform: translateY(1px); }
.btn.primary { background: var(--accent); color: var(--accent-text); border-color: transparent; }
.btn.primary:hover { background: var(--accent-hover); }
.btn.ghost { background: transparent; border-color: transparent; box-shadow: none; color: var(--text-2); }
.btn.ghost:hover { background: var(--bg-2); color: var(--text); }
.btn.danger:hover { color: var(--bad); background: var(--bad-soft); }
.btn.small { padding: 4px 9px; font-size: 13px; }
.btn.block { width: 100%; justify-content: center; }
.btn:disabled { opacity: .55; cursor: default; transform: none; }
.icon-btn { padding: 6px; }
.icon-btn svg.i { width: 18px; height: 18px; }
kbd { display: inline-block; font-size: 12px; line-height: 16px; padding: 0 5px; border: 1px solid var(--line-2); border-bottom-width: 2px; border-radius: 4px; color: var(--text-2); background: var(--panel); }
.kbd-hint { display: inline-flex; align-items: center; gap: 3px; color: var(--text-3); font-size: 12px; }

/* Fields */
input, textarea { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line-2); border-radius: var(--r-sm); padding: 8px 10px; width: 100%; transition: border-color .15s var(--ease), box-shadow .15s var(--ease); }
input::placeholder, textarea::placeholder { color: var(--text-3); }
input:hover, textarea:hover { border-color: var(--text-3); }
input:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
textarea { resize: vertical; min-height: 120px; line-height: 1.55; }
label { display: block; font-size: 12.5px; font-weight: 500; color: var(--text-2); margin: 0 0 6px; }
.field + .field, .row + .field, .field + .row { margin-top: 14px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.row > .field { margin-top: 0; }

/* Top bar */
.topbar { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 14px 0 12px; background: var(--panel); border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 14.5px; letter-spacing: -.01em; color: var(--text); text-decoration: none; }
.mark { width: 24px; height: 24px; border-radius: 7px; background: var(--accent); color: var(--accent-text); display: grid; place-items: center; }
.mark svg.i { width: 14px; height: 14px; stroke-width: 2.2; }
#menu { display: none; }
.health { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text-2); padding: 4px 10px 4px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); display: inline-block; flex: none; }
.dot.ok { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
.dot.bad { background: var(--bad); box-shadow: 0 0 0 3px var(--bad-soft); }
.dot.warn { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-soft); }

/* Layout */
.layout { display: grid; grid-template-columns: 296px 1fr; min-height: 0; position: relative; }
aside { border-right: 1px solid var(--line); background: var(--panel-2); display: flex; flex-direction: column; min-height: 0; }
.side-top { padding: 12px; display: grid; gap: 10px; }
.open-form { position: relative; display: flex; }
.open-form svg.i { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
.open-form input { padding-left: 32px; padding-right: 60px; font-size: 13px; }
.open-form .btn { position: absolute; right: 4px; top: 4px; bottom: 4px; padding: 0 9px; line-height: 1; font-size: 12.5px; }
.side-label { display: flex; align-items: baseline; justify-content: space-between; padding: 10px 16px 6px; font-size: 11.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); }
.side-label #session-count { font-weight: 500; letter-spacing: 0; text-transform: none; }
.side-label .btn.icon-btn { padding: 3px; margin: -5px -6px -5px 0; }
.side-label .btn.icon-btn svg.i { width: 14px; height: 14px; }
.side-label .btn.icon-btn.spin svg.i { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.side-filter { display: flex; gap: 2px; padding: 0 12px 8px; }
.seg { font: inherit; font-size: 12px; font-weight: 500; color: var(--text-2); background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 2px 8px; cursor: pointer; line-height: 18px; transition: background .15s var(--ease), color .15s var(--ease); }
.seg:hover { background: var(--bg-2); color: var(--text); }
.seg[aria-pressed="true"] { background: var(--panel); border-color: var(--line); color: var(--text); box-shadow: var(--shadow-sm); }
.sessions { overflow: auto; flex: 1; padding: 0 8px 12px; display: grid; gap: 2px; align-content: start; }
.session { font: inherit; text-align: left; color: inherit; background: transparent; border: 1px solid transparent; width: 100%; padding: 9px 10px; border-radius: var(--r-sm); cursor: pointer; display: grid; gap: 3px; transition: background .15s var(--ease); }
.session:hover { background: var(--bg-2); }
.session.active { background: var(--panel); border-color: var(--line); box-shadow: var(--shadow-sm); }
.session .s-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.session .s-repo { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.session .s-time { color: var(--text-3); font-size: 11.5px; font-variant-numeric: tabular-nums; flex: none; }
.session .s-prompt { color: var(--text-2); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.session .s-prompt:empty::before { content: "No prompt yet"; color: var(--text-3); }
.side-empty { padding: 20px 12px; color: var(--text-2); font-size: 13px; line-height: 1.55; }
.side-empty strong { display: block; color: var(--text); font-weight: 600; margin-bottom: 3px; }
.session .s-issue { display: inline-flex; align-items: center; gap: 3px; flex: none; font-family: var(--mono); font-size: 11px; line-height: 16px; padding: 0 5px; border-radius: 5px; color: var(--text-2); background: var(--bg-2); border: 1px solid var(--line); }
.session .s-issue svg.i { width: 11px; height: 11px; }
.side-foot { padding: 4px 12px 12px; display: grid; gap: 8px; }
.side-foot:empty { display: none; }
.side-note { color: var(--text-3); font-size: 12px; line-height: 1.45; padding: 0 4px; }
.side-note.bad { color: var(--bad); }
[hidden] { display: none !important; }
.scrim { display: none; }

/* Status vocabulary */
.dot.running { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); animation: pulse 1.6s var(--ease) infinite; }
.dot.queued { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-soft); }
.dot.completed { background: var(--ok); }
.dot.failed, .dot.cancelled, .dot.disconnected { background: var(--bad); }
.dot.ignored, .dot.idle { background: var(--text-3); }
.pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; line-height: 18px; padding: 1px 8px 1px 7px; border-radius: 999px; background: var(--bg-2); color: var(--text-2); text-transform: capitalize; }
.pill.running { background: var(--accent-soft); color: var(--accent); }
.pill.queued { background: var(--warn-soft); color: var(--warn); }
.pill.completed { background: var(--ok-soft); color: var(--ok); }
.pill.failed, .pill.cancelled, .pill.disconnected { background: var(--bad-soft); color: var(--bad); }
.pill.ignored { background: var(--warn-soft); color: var(--warn); }
.pill .dot { box-shadow: none; }
.pill.running .dot { animation: pulse 1.6s var(--ease) infinite; }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 var(--accent-soft); } 50% { box-shadow: 0 0 0 4px var(--accent-soft); } }
.chip { display: inline-flex; align-items: center; font-family: var(--mono); font-size: 11.5px; line-height: 18px; padding: 2px 8px; border-radius: 6px; background: var(--bg-2); color: var(--text-2); border: 1px solid var(--line); }

/* Main */
main { display: flex; flex-direction: column; min-height: 0; }
.view { display: none; flex: 1; min-height: 0; flex-direction: column; }
.view.active { display: flex; }
.center { max-width: 640px; width: 100%; margin: 0 auto; padding: 56px 24px 40px; }
.page-title { font-size: 22px; font-weight: 600; letter-spacing: -.02em; margin: 0 0 6px; line-height: 1.25; }
.lede { color: var(--text-2); margin: 0 0 28px; max-width: 56ch; }
.form { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); padding: 20px; box-shadow: var(--shadow); }
.form-foot { display: flex; align-items: center; justify-content: flex-end; gap: 14px; margin-top: 18px; flex-wrap: wrap; }
.form-foot .error { margin-right: auto; }

/* Session header */
.session-head { padding: 10px 20px; background: var(--panel); border-bottom: 1px solid var(--line); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; min-height: 52px; }
.session-head .title { font-weight: 600; font-size: 14.5px; letter-spacing: -.01em; }
.id-btn { font: inherit; display: inline-flex; align-items: center; gap: 6px; color: var(--text-3); background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 2px 6px; cursor: pointer; transition: all .15s var(--ease); }
.id-btn code { font-size: 12px; }
.id-btn:hover { color: var(--text); background: var(--bg-2); border-color: var(--line); }
.id-btn svg.i { width: 13px; height: 13px; }

/* Transcript */
.transcript { flex: 1; overflow: auto; padding: 24px 20px 12px; }
.transcript-inner { max-width: 820px; margin: 0 auto; display: grid; gap: 28px; }
.turn { display: grid; gap: 14px; }
.msg.user { display: flex; justify-content: flex-end; }
.bubble.user { background: var(--user); border-radius: 16px 16px 4px 16px; padding: 10px 14px; max-width: 78%; white-space: pre-wrap; word-break: break-word; }
.msg.agent { display: grid; grid-template-columns: 26px 1fr; gap: 12px; }
.avatar { width: 26px; height: 26px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); color: var(--text-2); display: grid; place-items: center; margin-top: 1px; }
.avatar svg.i { width: 14px; height: 14px; }
.agent-body { min-width: 0; display: grid; gap: 10px; align-content: start; }
.status-line { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; color: var(--text-2); font-size: 13px; min-height: 22px; }
.tools { display: flex; gap: 6px; flex-wrap: wrap; }
.tools:empty { display: none; }
.tool { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11.5px; line-height: 18px; padding: 2px 8px 2px 7px; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); color: var(--text-2); }
.tool .dot { width: 6px; height: 6px; }
.tool .n { color: var(--text-3); font-size: 11px; }
.tool.running { border-color: var(--accent); color: var(--accent); }
.tool.error { border-color: var(--bad); color: var(--bad); }
.tool.error .dot { background: var(--bad); }
.stream { white-space: pre-wrap; word-break: break-word; color: var(--text-2); font-size: 13.5px; line-height: 1.55; }
.stream.live:last-child::after { content: ""; display: inline-block; width: 7px; height: 14px; margin-left: 2px; vertical-align: -2px; background: var(--accent); border-radius: 1px; animation: blink 1s steps(2, start) infinite; }
@keyframes blink { to { visibility: hidden; } }
.skeleton { display: grid; gap: 8px; padding-top: 2px; }
.skeleton i { display: block; height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--bg-2) 25%, var(--line) 50%, var(--bg-2) 75%); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
.skeleton i:nth-child(1) { width: 62%; } .skeleton i:nth-child(2) { width: 84%; } .skeleton i:nth-child(3) { width: 40%; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.result { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow-sm); overflow: hidden; }
.result.failed { border-color: color-mix(in srgb, var(--bad) 40%, var(--line)); }
.result.ignored { border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); }
.result .body { padding: 14px 16px; }
.result .foot { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-top: 1px solid var(--line); background: var(--panel-2); color: var(--text-2); font-size: 12.5px; }
.result .foot code { font-size: 12px; color: var(--text); }
.result .foot svg.i { width: 14px; height: 14px; color: var(--text-3); }
.result .body.plain { white-space: pre-wrap; word-break: break-word; }
details.diag { border-top: 1px solid var(--line); }
details.diag summary { cursor: pointer; padding: 8px 16px; font-size: 12.5px; color: var(--text-2); list-style: none; display: flex; align-items: center; gap: 6px; user-select: none; }
details.diag summary::-webkit-details-marker { display: none; }
details.diag summary svg.i { width: 14px; height: 14px; transition: transform .15s var(--ease); }
details.diag[open] summary svg.i { transform: rotate(90deg); }
details.diag pre { margin: 0; padding: 12px 16px; font-size: 12px; line-height: 1.5; color: var(--text-2); background: var(--code); white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; }

/* Rendered markdown */
.md { font-size: 14px; line-height: 1.6; word-break: break-word; }
.md > :first-child { margin-top: 0; } .md > :last-child { margin-bottom: 0; }
.md p, .md ul, .md ol, .md pre, .md blockquote { margin: 0 0 12px; }
.md h1, .md h2, .md h3, .md h4 { font-weight: 600; letter-spacing: -.01em; line-height: 1.3; margin: 20px 0 8px; }
.md h1 { font-size: 18px; } .md h2 { font-size: 16px; } .md h3, .md h4 { font-size: 14px; }
.md ul, .md ol { padding-left: 22px; } .md li { margin: 3px 0; } .md li > p { margin: 0; }
.md code { font-size: 12.5px; background: var(--code); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
.md pre { background: var(--code); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px 14px; overflow: auto; font-size: 12.5px; line-height: 1.5; }
.md pre code { background: none; border: 0; padding: 0; font-size: inherit; }
.md blockquote { border-left: 1px solid var(--line-2); padding-left: 12px; color: var(--text-2); }
.md a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.md hr { border: 0; border-top: 1px solid var(--line); margin: 16px 0; }
.md table { border-collapse: collapse; margin: 0 0 12px; font-size: 13px; } .md th, .md td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; }

/* Composer */
.composer { padding: 12px 20px 16px; background: linear-gradient(to bottom, transparent, var(--bg) 30%); }
.composer-box { max-width: 820px; margin: 0 auto; background: var(--panel); border: 1px solid var(--line-2); border-radius: 12px; box-shadow: var(--shadow); transition: border-color .15s var(--ease), box-shadow .15s var(--ease); }
.composer-box:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow); }
.composer-box textarea { border: 0; box-shadow: none; background: transparent; min-height: 58px; padding: 12px 14px 4px; resize: none; }
.composer-box textarea:focus { box-shadow: none; }
.composer-foot { display: flex; align-items: center; gap: 12px; padding: 6px 8px 8px 14px; }
.composer-foot .error { flex: 1; }
.composer-foot .kbd-hint { margin-left: auto; }
.btn.steer { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, var(--line-2)); background: var(--warn-soft); }
.btn.steer:hover { border-color: var(--warn); }

/* Dialogs */
dialog { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--text); padding: 0; width: min(560px, 92vw); box-shadow: var(--shadow-lg); }
dialog::backdrop { background: rgba(20, 18, 14, .45); backdrop-filter: blur(2px); }
.dialog-head { display: flex; align-items: center; gap: 10px; padding: 16px 16px 12px 22px; border-bottom: 1px solid var(--line); }
.dialog-head h2 { margin: 0; font-size: 15.5px; font-weight: 600; letter-spacing: -.01em; }
.dialog-body { padding: 18px 22px 22px; display: grid; gap: 22px; }
.section h3 { margin: 0 0 3px; font-size: 13.5px; font-weight: 600; }
.section .hint { margin: 0 0 14px; }
.section-actions { display: flex; align-items: center; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.section-actions .hint { margin: 0; }
.inspect { font-family: var(--mono); font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; background: var(--code); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px 14px; max-height: 55vh; overflow: auto; color: var(--text-2); }

/* Toast */
#toast { position: fixed; bottom: 20px; left: 50%; transform: translate(-50%, 8px); background: var(--text); color: var(--bg); padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 500; box-shadow: var(--shadow-lg); opacity: 0; transition: opacity .18s var(--ease), transform .18s var(--ease); pointer-events: none; z-index: 20; }
#toast.show { opacity: 1; transform: translate(-50%, 0); }

@media (max-width: 800px) {
  .layout { grid-template-columns: 1fr; }
  #menu { display: inline-flex; }
  .brand span { display: none; }
  aside { position: fixed; inset: 52px auto 0 0; width: min(320px, 86vw); z-index: 10; transform: translateX(-100%); transition: transform .22s var(--ease); box-shadow: none; border-right: 1px solid var(--line); }
  aside.open { transform: none; box-shadow: var(--shadow-lg); }
  .scrim { display: block; position: fixed; inset: 52px 0 0 0; background: rgba(20,18,14,.35); z-index: 9; opacity: 0; pointer-events: none; transition: opacity .2s var(--ease); }
  .scrim.show { opacity: 1; pointer-events: auto; }
  .row { grid-template-columns: 1fr; }
  .center { padding: 28px 16px; }
  .session-head { padding: 10px 14px; }
  .session-head .btn .t { display: none; }
  .transcript { padding: 16px 14px 8px; }
  .composer { padding: 8px 12px 12px; }
  .bubble.user { max-width: 92%; }
  .health span:last-child { display: none; }
}
@media (prefers-reduced-motion: reduce) { *, *::after, *::before { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
  <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8"/></symbol>
  <symbol id="i-bot" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 14h.01M15 14h.01"/></symbol>
  <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></symbol>
  <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
  <symbol id="i-send" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></symbol>
  <symbol id="i-stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></symbol>
  <symbol id="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></symbol>
  <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol>
  <symbol id="i-branch" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 7.5v9M18 10.5c0 4-12 2-12 6"/></symbol>
  <symbol id="i-chevron" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></symbol>
  <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></symbol>
  <symbol id="i-issue" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/></symbol>
</svg>
<header class="topbar">
  <button class="btn ghost icon-btn" id="menu" aria-label="Show sessions" aria-controls="sidebar" aria-expanded="false"><svg class="i"><use href="#i-menu"/></svg></button>
  <a class="brand" href="/"><span class="mark"><svg class="i"><use href="#i-spark"/></svg></span><span>Agent Console</span></a>
  <span class="spacer"></span>
  <span class="health" id="health" role="status"><span class="dot" id="health-dot"></span><span id="health-text">Checking…</span></span>
  <button class="btn ghost" id="open-settings"><svg class="i"><use href="#i-sliders"/></svg><span class="t">Settings</span></button>
</header>
<div class="layout">
  <div class="scrim" id="scrim"></div>
  <aside id="sidebar">
    <div class="side-top">
      <button class="btn primary block" id="new-session"><svg class="i"><use href="#i-plus"/></svg>New session</button>
      <form id="open-form" class="open-form"><svg class="i"><use href="#i-search"/></svg><input id="open-id" placeholder="Open by session ID" autocomplete="off" spellcheck="false" aria-label="Session ID"><button type="submit" class="btn small">Open</button></form>
    </div>
    <div class="side-label"><span>Sessions <span id="session-count"></span></span><button class="btn ghost icon-btn" id="refresh-sessions" title="Refresh from the session index" aria-label="Refresh sessions"><svg class="i"><use href="#i-refresh"/></svg></button></div>
    <div class="side-filter" role="group" aria-label="Filter by status">
      <button type="button" class="seg" data-filter="" aria-pressed="true">All</button>
      <button type="button" class="seg" data-filter="running" aria-pressed="false">Running</button>
      <button type="button" class="seg" data-filter="completed" aria-pressed="false">Completed</button>
      <button type="button" class="seg" data-filter="failed" aria-pressed="false">Failed</button>
    </div>
    <div class="sessions" id="sessions"></div>
    <div class="side-foot" id="side-foot"></div>
  </aside>
  <main>
    <section class="view active" id="view-new">
      <div class="center">
        <h2 class="page-title">Start a session</h2>
        <p class="lede">The agent clones the repository, works on an agent branch, and streams progress here. Commands are accepted immediately; the turn itself can take minutes.</p>
        <form id="create-form" class="form">
          <div class="row">
            <div class="field"><label for="repository">Repository</label><input id="repository" placeholder="owner/repo" required autocomplete="off" spellcheck="false"></div>
            <div class="field"><label for="model">OpenRouter model</label><input id="model" placeholder="anthropic/claude-sonnet-4.5" required autocomplete="off" spellcheck="false"></div>
          </div>
          <div class="field"><label for="prompt">Prompt</label><textarea id="prompt" placeholder="Explain the architecture. Do not modify files or push." required></textarea></div>
          <div class="form-foot"><span class="error" id="create-error" role="alert"></span><span class="kbd-hint"><kbd>⌘</kbd><kbd>↵</kbd></span><button class="btn primary" type="submit" id="create-btn">Run<svg class="i"><use href="#i-arrow"/></svg></button></div>
        </form>
      </div>
    </section>
    <section class="view" id="view-session">
      <div class="session-head">
        <span class="title" id="s-repo"></span>
        <span class="chip" id="s-model"></span>
        <span class="chip" id="s-issue" hidden></span>
        <button class="id-btn" id="copy-id" title="Copy session ID"><code id="s-id"></code><svg class="i"><use href="#i-copy"/></svg></button>
        <span class="spacer"></span>
        <button class="btn ghost danger" id="stop"><svg class="i"><use href="#i-stop"/></svg><span class="t">Stop</span></button>
        <button class="btn ghost" id="inspect"><svg class="i"><use href="#i-eye"/></svg><span class="t">Inspect</span></button>
        <button class="btn ghost danger" id="forget" title="Forget this browser's copy of the transcript"><svg class="i"><use href="#i-trash"/></svg><span class="t">Forget</span></button>
      </div>
      <div class="transcript" id="transcript-scroll"><div class="transcript-inner" id="transcript"></div></div>
      <div class="composer">
        <div class="composer-box">
          <textarea id="followup" rows="2" placeholder="Add an instruction to this session…" aria-label="Follow-up prompt"></textarea>
          <div class="composer-foot"><span class="error" id="send-error" role="alert"></span><span class="hint">Queue waits. Steer interrupts.</span><span class="kbd-hint"><kbd>⌘</kbd><kbd>↵</kbd></span><button class="btn steer small" id="steer" type="button" title="Interrupt the active turn and run this next">Steer</button><button class="btn primary small" id="send" type="button" title="Run after earlier messages">Queue<svg class="i"><use href="#i-send"/></svg></button></div>
        </div>
      </div>
    </section>
  </main>
</div>
<dialog id="settings" aria-labelledby="settings-title">
  <div class="dialog-head"><h2 id="settings-title">Settings</h2><span class="spacer"></span><button class="btn ghost icon-btn" id="close-settings" aria-label="Close"><svg class="i"><use href="#i-x"/></svg></button></div>
  <div class="dialog-body">
    <div class="section">
      <h3>This browser</h3>
      <p class="hint">Stored locally only. The API token is sent as a Bearer header to this origin.</p>
      <div class="field"><label for="token">API token</label><input id="token" type="password" autocomplete="off"></div>
      <div class="row">
        <div class="field"><label for="default-repository">Default repository</label><input id="default-repository" placeholder="owner/repo" autocomplete="off" spellcheck="false"></div>
        <div class="field"><label for="default-model">Default model</label><input id="default-model" placeholder="anthropic/claude-sonnet-4.5" autocomplete="off" spellcheck="false"></div>
      </div>
      <div class="section-actions"><button class="btn primary" id="save-settings">Save</button><button class="btn ghost" id="clear-token">Forget token</button></div>
    </div>
    <div class="section">
      <h3>GitHub issue model rule</h3>
      <p class="hint">Overrides the default model for issues opened in one repository.</p>
      <form id="rule-form">
        <div class="row">
          <div class="field"><label for="rule-repository">Repository</label><input id="rule-repository" placeholder="owner/repo" required autocomplete="off" spellcheck="false"></div>
          <div class="field"><label for="rule-model">Model</label><input id="rule-model" placeholder="anthropic/claude-sonnet-4.5" required autocomplete="off" spellcheck="false"></div>
        </div>
        <div class="section-actions"><button class="btn" type="submit">Set rule</button><span class="hint" id="rule-status" role="status"></span></div>
      </form>
    </div>
  </div>
</dialog>
<dialog id="inspect-dialog" aria-labelledby="inspect-title">
  <div class="dialog-head"><h2 id="inspect-title">Stored session state</h2><span class="spacer"></span><button class="btn ghost icon-btn" id="close-inspect" aria-label="Close"><svg class="i"><use href="#i-x"/></svg></button></div>
  <div class="dialog-body"><div class="inspect" id="inspect-body">Loading…</div></div>
</dialog>
<div id="toast" role="status"></div>
<script>
(function () {
  'use strict';
  var KEY = 'agent-console';
  var $ = function (id) { return document.getElementById(id); };
  var state = load();
  var current = null;
  var active = {}; // sessionId:messageId -> AbortController while a stream is attached in this tab
  var BT = '\x60';

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
  function icon(name) { return '<svg class="i" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
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

  // ---------- Markdown (small, escape-first renderer for agent summaries) ----------
  function inline(s) {
    s = esc(s);
    var fence = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
    s = s.replace(fence, function (m, c) { return '<code>' + c + '</code>'; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  }
  function markdown(src) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n'), out = [], i = 0, m;
    function para(buf) { if (buf.length) out.push('<p>' + inline(buf.join('\n')) + '</p>'); }
    var buf = [];
    while (i < lines.length) {
      var line = lines[i];
      if (line.indexOf(BT + BT + BT) === 0) {
        para(buf); buf = []; var code = []; i++;
        while (i < lines.length && lines[i].indexOf(BT + BT + BT) !== 0) code.push(lines[i++]);
        i++; out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); continue;
      }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { para(buf); buf = []; var lv = Math.min(m[1].length, 4); out.push('<h' + lv + '>' + inline(m[2].replace(/\s+#+$/, '')) + '</h' + lv + '>'); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { para(buf); buf = []; out.push('<hr>'); i++; continue; }
      if ((m = /^\s*([-*+]|\d+[.)])\s+/.exec(line))) {
        para(buf); buf = [];
        var ordered = /\d/.test(m[1]), items = [];
        while (i < lines.length && (m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]))) {
          var item = [m[2]]; i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) item.push(lines[i++].trim());
          var sub = [];
          while (i < lines.length && /^\s{2,}([-*+]|\d+[.)])\s+/.test(lines[i])) sub.push(lines[i++].replace(/^\s{2}/, ''));
          items.push('<li>' + inline(item.join(' ')) + (sub.length ? markdown(sub.join('\n')) : '') + '</li>');
        }
        out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>')); continue;
      }
      if (/^\s*>\s?/.test(line)) { para(buf); buf = []; var q = []; while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); out.push('<blockquote>' + markdown(q.join('\n')) + '</blockquote>'); continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        para(buf); buf = []; var cells = function (l) { return l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return inline(c.trim()); }); };
        var head = cells(line); i += 2; var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push('<tr>' + cells(lines[i++]).map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>');
        out.push('<table><thead><tr>' + head.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>'); continue;
      }
      if (!line.trim()) { para(buf); buf = []; i++; continue; }
      buf.push(line); i++;
    }
    para(buf);
    return out.join('');
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
  async function streamRequest(url, onEvent, onGiveUp, signal) {
    var lastId = '';
    for (var attempt = 0; attempt < 6; attempt++) {
      if (signal && signal.aborted) return false;
      try {
        var res = await fetch(url, { headers: headers(lastId ? { 'last-event-id': lastId } : {}), signal: signal });
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        var terminal = await readEvents(res.body, function (frame) {
          if (frame.id) lastId = frame.id;
          var payload; try { payload = JSON.parse(frame.data); } catch (e) { return false; }
          return onEvent(payload) === true;
        });
        if (terminal) return true;
      } catch (e) { if (signal && signal.aborted) return false; if (attempt === 5) { onGiveUp(e); return false; } }
      await new Promise(function (r) { setTimeout(r, 1000 * (attempt + 1)); });
    }
    onGiveUp(new Error('Stream ended without a terminal event'));
    return false;
  }

  // ---------- Sessions ----------
  // localStorage keeps only the transcripts this browser streamed. The server's
  // session index (GET /sessions) supplies the list itself, including sessions
  // started by the GitHub issue webhook, so every session is visible here.
  var PAGE = 50;
  var remote = { items: [], byId: {}, cursor: null, paged: false, loading: false, loaded: false, unavailable: false, error: '', filter: '', seq: 0 };
  function session(id) { return state.sessions[id]; }
  function upsertSession(s) {
    if (!state.sessions[s.id]) state.order.unshift(s.id);
    state.sessions[s.id] = Object.assign(state.sessions[s.id] || { turns: [] }, s);
    save(); renderSidebar();
  }
  function time(v) { var n = typeof v === 'number' ? v : Date.parse(v); return isNaN(n) ? 0 : n; }
  function firstPrompt(s) { return s.turns[0] ? s.turns[0].prompt : ''; }
  // Issue sessions carry a fixed prompt prefix; the preview stored in the index is truncated, so the title may be cut short.
  function issueInfo(id, prompt) {
    var m = /^Address GitHub issue #(\d+)\b/.exec(prompt || '');
    if (!m && !/^issue-/.test(id || '')) return null;
    var t = /"title":"((?:[^"\\]|\\.)*)/.exec(prompt || '');
    return { number: m ? m[1] : '', title: t ? t[1].replace(/\\(.)/g, '$1') : '' };
  }
  function rowStatus(s, r) {
    var t = s && s.turns[s.turns.length - 1];
    if (t && (t.status === 'running' || t.status === 'queued') && active[s.id + ':' + t.messageId]) return t.status;
    if (r && !(t && t.finishedAt && t.finishedAt > time(r.updatedAt))) return r.status;
    return t ? t.status : r ? r.status : 'idle';
  }
  function sessionRows() {
    var rows = [], seen = {};
    remote.items.forEach(function (r) {
      seen[r.sessionId] = true;
      var s = session(r.sessionId);
      rows.push({ id: r.sessionId, repository: (s && s.repository) || r.repository, createdAt: r.createdAt, status: rowStatus(s, r), prompt: (s && firstPrompt(s)) || r.promptPreview });
    });
    state.order.forEach(function (id) {
      var s = session(id); if (!s || seen[id]) return;
      var st = rowStatus(s, null);
      if (remote.filter && st !== remote.filter) return;
      rows.push({ id: id, repository: s.repository, createdAt: s.createdAt, status: st, prompt: firstPrompt(s) || (s.source === 'opened' ? 'Opened by ID' : '') });
    });
    rows.sort(function (a, b) { return time(b.createdAt) - time(a.createdAt); });
    return rows;
  }
  function renderSidebar() {
    var el = $('sessions'); el.innerHTML = '';
    var rows = sessionRows();
    $('session-count').textContent = rows.length ? String(rows.length) + (remote.cursor ? '+' : '') : '';
    $('refresh-sessions').classList.toggle('spin', remote.loading);
    if (!rows.length) {
      el.innerHTML = '<div class="side-empty">' + (remote.loading && !remote.loaded ? 'Loading sessions…'
        : remote.filter ? '<strong>No ' + esc(remote.filter) + ' sessions</strong>Nothing in the index matches this filter.'
        : '<strong>No sessions yet</strong>Start one with the form, or open an existing session by its ID.' + (remote.loaded ? ' Sessions started from GitHub issues appear here too.' : '')) + '</div>';
    }
    rows.forEach(function (r) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'session' + (current === r.id ? ' active' : '');
      var issue = issueInfo(r.id, r.prompt);
      var preview = issue ? (issue.title || (issue.number ? 'GitHub issue #' + issue.number : 'GitHub issue')) : r.prompt;
      b.innerHTML = '<div class="s-row"><span class="s-repo">' + esc(r.repository || 'unknown repository') + '</span><span class="s-time">' + esc(r.createdAt ? when(r.createdAt) : '') + '</span></div>' +
        '<div class="s-row"><span class="dot ' + esc(r.status) + '" title="' + esc(r.status) + '"></span>' +
        (issue ? '<span class="s-issue" title="Started from a GitHub issue">' + icon('issue') + (issue.number ? '#' + esc(issue.number) : 'issue') + '</span>' : '') +
        '<span class="s-prompt">' + esc(preview) + '</span></div>';
      b.onclick = function () { open(r.id); closeDrawer(); };
      el.appendChild(b);
    });
    var foot = $('side-foot'); foot.innerHTML = '';
    if (remote.error) foot.innerHTML = '<div class="side-note bad">' + esc(remote.error) + '</div>';
    else if (!state.token) foot.innerHTML = '<div class="side-note">Set the API token in Settings to load the session index.</div>';
    if (remote.cursor) foot.innerHTML += '<button type="button" class="btn small block" id="load-more"' + (remote.loading ? ' disabled' : '') + '>' + (remote.loading ? 'Loading…' : 'Load older sessions') + '</button>';
    var more = $('load-more'); if (more) more.onclick = function () { loadSessions('more'); };
  }
  // mode: 'reset' replaces the list, 'more' appends the next page, 'refresh' re-reads the first page and merges it.
  async function loadSessions(mode) {
    var seq = ++remote.seq;
    if (!state.token) { remote.items = []; remote.byId = {}; remote.cursor = null; remote.paged = false; remote.loaded = false; remote.error = ''; renderSidebar(); return; }
    var more = mode === 'more';
    if (more && (!remote.cursor || remote.loading)) return;
    remote.loading = true; remote.error = ''; renderSidebar();
    try {
      var data = await call('GET', '/sessions?limit=' + PAGE + (remote.filter ? '&status=' + remote.filter : '') + (more ? '&cursor=' + encodeURIComponent(remote.cursor) : ''));
      if (seq !== remote.seq) return;
      var replace = !more && !(mode === 'refresh' && remote.paged);
      if (replace) { remote.items = []; remote.byId = {}; remote.paged = false; }
      data.sessions.forEach(function (r) {
        var known = remote.byId[r.sessionId];
        if (known) Object.assign(known, r); else { remote.byId[r.sessionId] = r; remote.items.push(r); }
      });
      if (more || replace) remote.cursor = data.nextCursor;
      if (more) remote.paged = true;
      remote.loaded = true; remote.unavailable = false;
    } catch (err) {
      if (seq !== remote.seq) return;
      remote.unavailable = err.message === 'Service unavailable';
      remote.error = remote.unavailable ? 'Session index unavailable; showing only this browser\'s sessions. Configure SESSION_DATABASE_URL to list every session.'
        : err.message === 'Unauthorized' ? 'The session index rejected the API token.' : 'Could not load sessions: ' + err.message;
    }
    remote.loading = false; renderSidebar();
  }
  var refreshTimer = null;
  function refreshSoon(ms) { clearTimeout(refreshTimer); refreshTimer = setTimeout(function () { loadSessions('refresh'); }, ms || 0); }
  function setFilter(value) {
    remote.filter = value;
    Array.prototype.forEach.call(document.querySelectorAll('.seg'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-filter') === value ? 'true' : 'false'); });
    loadSessions('reset');
  }
  Array.prototype.forEach.call(document.querySelectorAll('.seg'), function (b) { b.onclick = function () { setFilter(b.getAttribute('data-filter') || ''); }; });
  $('refresh-sessions').onclick = function () { loadSessions('refresh'); };
  setInterval(function () { if (document.visibilityState === 'visible' && state.token && !remote.loading && !remote.unavailable) loadSessions('refresh'); }, 30000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && state.token && remote.loaded) loadSessions('refresh'); });

  // Opens any session: one streamed here, one from the index, or one typed by ID.
  function open(id) {
    if (!session(id)) {
      var r = remote.byId[id] || {};
      upsertSession({ id: id, repository: r.repository, model: r.model, createdAt: r.createdAt || Date.now(), source: r.sessionId ? 'indexed' : 'opened', turns: [] });
    }
    show(id);
    hydrate(id);
  }
  // Reads the indexed snapshot; falls back to the worker's workspace snapshot when the index lacks it.
  async function hydrate(id) {
    var s = session(id); if (!s || !state.token) return;
    try {
      var data = await call('GET', '/sessions/inspect?sessionId=' + encodeURIComponent(id));
      remote.unavailable = false;
      applySnapshot(s, data.session);
    } catch (err) {
      if (err.message === 'Service unavailable') remote.unavailable = true;
      if (err.message === 'Session not found' || remote.unavailable) { if (!s.turns.length) await inspect(id, false); }
      else toast('Could not load session: ' + err.message);
    }
  }
  function applySnapshot(s, d) {
    if (!d) return false;
    var changed = false;
    if (d.repository && s.repository !== d.repository) { s.repository = d.repository; changed = true; }
    if (d.model && s.model !== d.model) { s.model = d.model; changed = true; }
    if (d.createdAt && s.createdAt !== d.createdAt) { s.createdAt = d.createdAt; changed = true; }
    var last = s.turns[s.turns.length - 1];
    var target = d.messageId ? s.turns.find(function (t) { return t.messageId === d.messageId; }) : last;
    // Upgrade snapshots cached before turn identities were persisted.
    if (!target && last && last.messageId === 'stored') target = last;
    if (!target && d.prompt) {
      target = { messageId: d.messageId || 'stored', prompt: d.requestPrompt || d.prompt, status: 'running', phase: 'elsewhere', blocks: [], tools: [] };
      s.turns.push(target); changed = true;
    }
    if (target && !active[s.id + ':' + target.messageId]) {
      if (d.messageId) {
        target.messageId = d.messageId;
        target.stream = '/turns/events?sessionId=' + encodeURIComponent(s.id) + '&messageId=' + encodeURIComponent(d.messageId);
      }
      if (d.status !== 'running') finishStored(target, s, d);
      changed = true;
    }
    // Worker snapshots also carry the durable message queue for turns this browser dispatched.
    if (Array.isArray(d.messages)) d.messages.forEach(function (job) {
      var turn = null; for (var i = 0; i < s.turns.length; i++) if (s.turns[i].messageId === job.messageId) turn = s.turns[i];
      if (!turn || active[s.id + ':' + turn.messageId]) return;
      if (job.state === 'queued') { if (turn.status !== 'queued') changed = true; turn.status = 'queued'; turn.mode = job.mode || turn.mode; }
      else if (job.state === 'running') { if (turn.status !== 'disconnected') changed = true; turn.status = 'disconnected'; }
      else if (job.state === 'finished' && job.result && (turn.status === 'running' || turn.status === 'queued' || turn.status === 'disconnected')) { applyEvent(s, turn, job.result); changed = true; }
    });
    if (changed) { save(); if (current === s.id) show(s.id); else renderSidebar(); }
    return changed;
  }
  function finishStored(t, s, d) {
    if (Array.isArray(d.tools)) t.tools = d.tools;
    t.status = d.status; t.phase = ''; t.response = d.response; t.diagnostic = d.diagnostic; t.branch = 'agent/' + s.id;
    t.error = d.status === 'failed' ? 'Run failed (from stored state).' : undefined;
    if (!t.finishedAt) t.finishedAt = time(d.updatedAt) || Date.now();
  }
  // Older snapshots lack a turn ID; keep summary polling as a compatibility fallback.
  var pollTimer = null;
  function schedulePoll() {
    clearTimeout(pollTimer);
    var s = session(current); if (!s || remote.unavailable) return;
    var t = s.turns[s.turns.length - 1];
    if (t && t.status === 'running' && !t.stream) pollTimer = setTimeout(function () { hydrate(s.id).then(schedulePoll); }, 8000);
  }
  function openDrawer() { $('sidebar').classList.add('open'); $('scrim').classList.add('show'); $('menu').setAttribute('aria-expanded', 'true'); }
  function closeDrawer() { $('sidebar').classList.remove('open'); $('scrim').classList.remove('show'); $('menu').setAttribute('aria-expanded', 'false'); }
  function showNew() {
    current = null; clearTimeout(pollTimer);
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
    var issue = issueInfo(id, firstPrompt(s));
    $('s-issue').hidden = !issue;
    if (issue) $('s-issue').textContent = 'GitHub issue' + (issue.number ? ' #' + issue.number : '');
    $('s-id').textContent = s.id;
    $('send-error').textContent = '';
    renderTranscript(s);
    renderSidebar();
    s.turns.forEach(function (t) { if ((t.status === 'running' || t.status === 'queued') && !active[id + ':' + t.messageId] && t.stream) attach(s, t); });
    schedulePoll();
  }

  // ---------- Turns ----------
  function renderTranscript(s) {
    var el = $('transcript'); el.innerHTML = '';
    s.turns.forEach(function (t) { el.appendChild(turnElement(s, t)); });
    var sc = $('transcript-scroll'); sc.scrollTop = sc.scrollHeight;
  }
  function turnElement(s, t) {
    var d = document.createElement('div'); d.className = 'turn'; d.id = 'turn-' + t.messageId;
    d.innerHTML = '<div class="msg user"><div class="bubble user">' + esc(t.prompt) + '</div></div>' +
      '<div class="msg agent"><div class="avatar">' + icon('bot') + '</div><div class="agent-body"><div class="status-line"></div><div class="tools"></div><div class="blocks"></div><div class="final"></div></div></div>';
    paintTurn(d, s, t);
    return d;
  }
  function phaseText(t) {
    if (t.status === 'queued') return t.mode === 'steer' ? 'Steering — waiting for the active turn to stop' : 'Queued — waiting for earlier messages';
    if (t.status === 'running') {
      if (!t.phase) return 'Dispatched — waiting for the session to start';
      return { started: 'Session started', waiting_for_workspace: 'Waiting for the shared workspace lock', checkout: 'Checking out the repository', agent_starting: 'Starting the agent', working: 'Agent is working', elsewhere: 'Agent is running; started outside this tab, so progress is refreshed from the session index' }[t.phase] || t.phase;
    }
    if (t.status === 'disconnected') return 'Stream interrupted. The agent may still be running.';
    var took = t.finishedAt && t.startedAt ? ' in ' + Math.max(1, Math.round((t.finishedAt - t.startedAt) / 1000)) + 's' : '';
    return { completed: 'Turn finished' + took, cancelled: 'Turn stopped' + took, failed: 'Turn failed' + took, ignored: 'Turn ignored' }[t.status] || t.status;
  }
  function groupTools(list) {
    var groups = [], byName = {};
    (list || []).forEach(function (x) {
      var g = byName[x.tool]; if (!g) { g = byName[x.tool] = { tool: x.tool, n: 0, running: 0, error: 0 }; groups.push(g); }
      g.n++; if (x.status === 'running') g.running++; if (x.status === 'error') g.error++;
    });
    return groups;
  }
  function paintTurn(d, s, t) {
    var status = d.querySelector('.status-line');
    var resume = t.status === 'disconnected' && t.stream ? '<button class="btn small" data-resume="1">' + icon('refresh') + 'Reconnect</button>' : '';
    status.innerHTML = '<span class="pill ' + esc(t.status) + '"><span class="dot"></span>' + esc(t.status) + '</span><span>' + esc(phaseText(t)) + '</span>' + resume;
    var rb = status.querySelector('[data-resume]'); if (rb) rb.onclick = function () { t.status = 'running'; save(); paintTurn(d, s, t); attach(s, t); };
    var tools = d.querySelector('.tools'); tools.innerHTML = '';
    groupTools(t.tools).forEach(function (g) {
      var cls = g.running ? 'running' : g.error ? 'error' : 'done';
      var title = g.tool + ': ' + g.n + (g.n === 1 ? ' call' : ' calls') + (g.running ? ', ' + g.running + ' running' : '') + (g.error ? ', ' + g.error + ' failed' : '');
      tools.innerHTML += '<span class="tool ' + cls + '" title="' + esc(title) + '"><span class="dot ' + (g.running ? 'running' : g.error ? 'failed' : 'completed') + '"></span>' + esc(g.tool) + (g.n > 1 ? '<span class="n">×' + g.n + '</span>' : '') + '</span>';
    });
    var blocks = d.querySelector('.blocks'); blocks.innerHTML = '';
    if (t.status !== 'completed') {
      var live = t.status === 'running';
      (t.blocks || []).forEach(function (b) { if (b.text) blocks.innerHTML += '<div class="stream' + (live ? ' live' : '') + '" data-part="' + esc(b.partId) + '">' + esc(b.text) + '</div>'; });
      if (live && !blocks.innerHTML) blocks.innerHTML = '<div class="skeleton" aria-hidden="true"><i></i><i></i><i></i></div>';
    }
    var fin = d.querySelector('.final'); fin.innerHTML = '';
    if (t.status === 'completed') {
      fin.innerHTML = '<div class="result completed">' +
        (t.response ? '<div class="body md">' + markdown(t.response) + '</div>' : '<div class="body plain hint">The agent completed without a summary. Inspect the session for stored state.</div>') +
        (t.branch ? '<div class="foot">' + icon('branch') + '<span>Branch <code>' + esc(t.branch) + '</code> — a push is only certain if the agent reports one.</span></div>' : '') + '</div>';
    }
    if (t.status === 'failed') {
      fin.innerHTML = '<div class="result failed"><div class="body plain">' + esc(t.error || 'Run failed.') + '</div>' +
        (t.diagnostic ? '<details class="diag"><summary>' + icon('chevron') + 'Diagnostic details</summary><pre>' + esc(JSON.stringify(t.diagnostic, null, 2)) + '</pre></details>' : '') + '</div>';
    }
    if (t.status === 'cancelled') fin.innerHTML = '<div class="result failed"><div class="body plain">Stopped by the operator. Queued messages were preserved.</div></div>';
    if (t.status === 'ignored') fin.innerHTML = '<div class="result ignored"><div class="body plain">Ignored: ' + esc(t.reason || '') + '</div></div>';
  }
  function repaint(s, t) {
    if (current !== s.id) return;
    var sc = $('transcript-scroll'), el = $('transcript'), d = document.getElementById('turn-' + t.messageId);
    var stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 40;
    if (d) paintTurn(d, s, t); else el.appendChild(turnElement(s, t));
    if (stick) sc.scrollTop = sc.scrollHeight;
  }
  function applyEvent(s, t, p) {
    var d = p.data || {};
    switch (p.type) {
      case 'queued': t.status = 'queued'; t.mode = d.mode || t.mode || 'queue'; break;
      case 'started': t.status = 'running'; t.phase = t.phase || 'started'; break;
      case 'status': t.status = 'running'; t.phase = d.phase; break;
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
      case 'cancelled': t.status = 'cancelled'; break;
      case 'failed': t.status = 'failed'; t.error = d.error; t.diagnostic = d.diagnostic || (d.code ? { code: d.code } : undefined); break;
      case 'ignored': t.status = 'ignored'; t.reason = d.reason; break;
      default: return false;
    }
    var terminal = t.status !== 'running' && t.status !== 'queued';
    if (terminal && !t.finishedAt) t.finishedAt = Date.now();
    if (terminal || p.type === 'status' || p.type === 'tool.status') save(); else throttleSave();
    repaint(s, t); if (terminal) { renderSidebar(); refreshSoon(1500); }
    return terminal;
  }
  var saveTimer = null;
  function throttleSave() { if (saveTimer) return; saveTimer = setTimeout(function () { saveTimer = null; save(); }, 500); }
  function attach(s, t) {
    var key = s.id + ':' + t.messageId; if (active[key]) return;
    var controller = new AbortController(); active[key] = controller;
    streamRequest(t.stream, function (p) { return applyEvent(s, t, p); }, function () { t.status = 'disconnected'; save(); repaint(s, t); renderSidebar(); }, controller.signal)
      .then(function () { if (active[key] === controller) delete active[key]; });
  }
  function newTurn(prompt, accepted, mode) {
    return { messageId: accepted.messageId, prompt: prompt, stream: accepted.stream, status: 'running', mode: mode || 'queue', phase: '', blocks: [], tools: [], startedAt: Date.now() };
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
  async function sendFollowup(mode) {
    var s = session(current); if (!s) return;
    var prompt = $('followup').value; if (!prompt.trim()) return;
    $('send-error').textContent = ''; $('send').disabled = true; $('steer').disabled = true;
    try {
      var accepted = await call('POST', '/sessions/messages', { sessionId: s.id, prompt: prompt, mode: mode });
      var t = newTurn(prompt, accepted, mode); s.turns.push(t); save();
      $('followup').value = ''; repaint(s, t); attach(s, t); renderSidebar();
    } catch (err) { $('send-error').textContent = err.message; }
    $('send').disabled = false; $('steer').disabled = false;
  }
  $('send').onclick = function () { sendFollowup('queue'); };
  $('steer').onclick = function () { sendFollowup('steer'); };
  $('followup').onkeydown = function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendFollowup(e.shiftKey ? 'steer' : 'queue'); };
  $('stop').onclick = async function () {
    var s = session(current); if (!s) return;
    $('stop').disabled = true; $('send-error').textContent = '';
    try {
      var accepted = await call('POST', '/sessions/cancel', { sessionId: s.id });
      await streamRequest(accepted.stream, function (p) {
        if (p.type === 'cancelled') {
          if (p.data && p.data.cancelled) {
            s.turns.forEach(function (t) {
              if (t.status !== 'running' && t.status !== 'disconnected') return;
              var key = s.id + ':' + t.messageId, controller = active[key];
              if (controller) controller.abort();
              t.status = 'cancelled'; t.finishedAt = Date.now(); repaint(s, t);
            });
            save(); renderSidebar(); toast('Active turn stopped; queued messages preserved');
          } else toast('No active turn to stop');
          return true;
        }
        if (p.type === 'failed') { $('send-error').textContent = p.data && p.data.error || 'Could not stop the turn'; return true; }
        return false;
      }, function (err) { $('send-error').textContent = 'Stop request failed: ' + err.message; });
    } catch (err) { $('send-error').textContent = err.message; }
    $('stop').disabled = false;
  };
  $('prompt').onkeydown = function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('create-form').requestSubmit(); };
  $('new-session').onclick = function () { showNew(); closeDrawer(); $('repository').focus(); };
  $('menu').onclick = function () { if ($('sidebar').classList.contains('open')) closeDrawer(); else openDrawer(); };
  $('scrim').onclick = closeDrawer;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('sidebar').classList.contains('open')) closeDrawer(); });
  $('copy-id').onclick = function () { navigator.clipboard.writeText(current).then(function () { toast('Session ID copied'); }, function () { toast(current); }); };
  $('forget').onclick = function () {
    if (!current || !confirm('Forget this browser\'s copy of the session? Server state and the session index are kept, so it stays listed.')) return;
    delete state.sessions[current]; state.order = state.order.filter(function (x) { return x !== current; }); save(); showNew();
  };
  $('open-form').onsubmit = async function (e) {
    e.preventDefault();
    var id = $('open-id').value.trim(); if (!/^[a-zA-Z0-9_-]+$/.test(id)) { toast('Invalid session ID'); return; }
    $('open-id').value = ''; open(id); closeDrawer();
  };
  async function inspect(id, modal) {
    var s = session(id); if (!s) return;
    if (modal) { $('inspect-body').textContent = 'Loading…'; $('inspect-dialog').showModal(); }
    try {
      var accepted = await call('POST', '/sessions/inspect', { sessionId: id });
      await streamRequest(accepted.stream, function (p) {
        if (p.type !== 'session') return false;
        var d = p.data;
        if (modal) $('inspect-body').textContent = d ? JSON.stringify(d, null, 2) : 'Unknown session (no stored state on the server).';
        applySnapshot(s, d);
        return true;
      }, function (err) { if (modal) $('inspect-body').textContent = 'Inspection stream failed: ' + err.message; });
    } catch (err) { if (modal) $('inspect-body').textContent = 'Inspection failed: ' + err.message; else toast('Inspection failed: ' + err.message); }
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
    paintHealth(); toast('Saved'); $('settings').close(); loadSessions('reset');
  };
  $('clear-token').onclick = function () { state.token = ''; $('token').value = ''; save(); paintHealth(); toast('Token removed'); loadSessions('reset'); };
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
    $('health-dot').className = 'dot ' + (online === null ? '' : !online ? 'bad' : state.token ? 'ok' : 'warn');
    $('health-text').textContent = online === null ? 'Checking…' : !online ? 'API unreachable' : state.token ? 'API online' : 'Token not set';
  }
  fetch('/health').then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function () { online = true; paintHealth(); }, function () { online = false; paintHealth(); });
  renderSidebar();
  showNew();
  if (!state.token) $('open-settings').click(); else loadSessions('reset');
})();
</script>
</body>
</html>
`;
