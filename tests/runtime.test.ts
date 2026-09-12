import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAgent, AgentError, stderrHints } from "../src/runtime.js";

test("OpenCode startup exit preserves safe diagnostics without stderr secrets", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-exit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "opencode"), '#!/bin/sh\necho "secret-token private-prompt: out of memory" >&2\nexit 42\n', { mode: 0o700 });
  await assert.rejects(runAgent({ root, directory: root, env: { PATH: root, HOME: root, XDG_DATA_HOME: root, XDG_CONFIG_HOME: root }, model: "test/model", prompt: "private-prompt", signal: AbortSignal.timeout(5000), onCreated: async () => {} }), error => {
    assert.ok(error instanceof AgentError);
    assert.equal(error.diagnostic.phase, "startup");
    assert.equal(error.diagnostic.exitCode, 42);
    assert.deepEqual(error.diagnostic.stderrHints, ["memory_error"]);
    assert.doesNotMatch(JSON.stringify(error), /secret-token|private-prompt/);
    return true;
  });
});
test("stderr classification never returns arbitrary provider output", () => {
  assert.deepEqual(stderrHints("Authorization: Bearer abc123"), []);
  assert.deepEqual(stderrHints("EACCES /private/repo"), ["permission_denied"]);
});

test("provider diagnostics retain categories and HTTP status without private payloads", async () => {
  const { providerDiagnostic, agentFailureMessage } = await import("../src/runtime.js");
  for (const statusCode of [401, 402, 403, 429, 500]) {
    const safe = providerDiagnostic({ name: "APIError", data: { statusCode, message: "private-prompt", responseBody: "secret-token", responseHeaders: { authorization: "secret-token" } } });
    assert.equal(safe.statusCode, statusCode);
    assert.equal(safe.reason, [401, 403].includes(statusCode) ? "provider_auth" : "provider_api");
    assert.doesNotMatch(JSON.stringify(safe), /private-prompt|secret-token/);
  }
  assert.deepEqual(providerDiagnostic({ name: "UnknownError", data: { message: "private" } }), {});
  assert.deepEqual(providerDiagnostic({ name: "APIError", data: { statusCode: "secret" } }), { reason: "provider_api" });
  assert.match(agentFailureMessage({ code: "opencode_failed", phase: "validate_model", stderrHints: [], reason: "model_not_found" }), /moonshotai\/kimi-k3/);
});

for (const scenario of ["invalid_model", "provider_error", "http_error", "success"] as const) {
  test(`OpenCode runtime handles ${scenario} through its HTTP protocol`, async t => {
    const root = await mkdtemp(path.join(tmpdir(), "opencode-protocol-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const trace = path.join(root, "requests.jsonl");
    await writeFile(path.join(root, "opencode"), `#!${process.execPath}
const http = require('node:http');
const fs = require('node:fs');
const server = http.createServer((req, res) => {
  fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({method:req.method, url:req.url})+'\\n');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/event') { res.writeHead(200, {'content-type':'text/event-stream'}); res.write('data: {"type":"server.connected","properties":{}}\\n\\n'); return; }
  res.setHeader('content-type','application/json');
  if (url.pathname === '/config/providers') return res.end(JSON.stringify({providers:[{id:'openrouter',models:{'moonshotai/kimi-k3':{id:'moonshotai/kimi-k3'}}}],default:{}}));
  if (url.pathname === '/session') return res.end(JSON.stringify({id:'session'}));
  if (${JSON.stringify(scenario)} === 'http_error') { res.statusCode=400; return res.end(JSON.stringify({name:'ProviderModelNotFoundError',data:{message:'private-prompt secret-token'}})); }
  res.end(JSON.stringify({info:{id:'assistant',sessionID:'session',role:'assistant',...(${JSON.stringify(scenario)} === 'provider_error' ? {error:{name:'APIError',data:{statusCode:402,message:'private-prompt secret-token',responseBody:'secret-token'}}} : {})},parts:[{type:'text',id:'part',sessionID:'session',messageID:'assistant',text:'Hello'}]}));
});
server.listen(0,'127.0.0.1',()=>console.log('opencode server listening on http://127.0.0.1:'+server.address().port));
`, { mode: 0o700 });
    let created = false;
    const result = runAgent({ root, directory: root, env: { PATH: root, HOME: root, XDG_DATA_HOME: root, XDG_CONFIG_HOME: root }, model: scenario === "invalid_model" ? "moonshot/kimi-k3" : "moonshotai/kimi-k3", prompt: "private-prompt", signal: AbortSignal.timeout(5000), onCreated: async () => { created = true; } });
    if (scenario === "success") assert.equal(await result, "Hello");
    else await assert.rejects(result, error => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.diagnostic.reason, scenario === "provider_error" ? "provider_api" : "model_not_found");
      assert.equal(error.diagnostic.phase, scenario === "invalid_model" ? "validate_model" : "prompt");
      if (scenario === "provider_error") assert.equal(error.diagnostic.statusCode, 402);
      assert.doesNotMatch(JSON.stringify(error), /secret-token|private-prompt/);
      return true;
    });
    assert.equal(created, scenario !== "invalid_model");
    if (scenario === "invalid_model") {
      const { readFile } = await import("node:fs/promises");
      assert.doesNotMatch(await readFile(trace, "utf8"), /\/session|\/event/);
    }
  });
}
