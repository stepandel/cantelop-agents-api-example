import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const appId = process.argv[2];
if (!appId || !/^app_[a-f0-9]+$/.test(appId)) {
  console.error("Usage: npm run env:upload -- APP_ID");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(new URL("../cantelop.json", import.meta.url), "utf8"));
const values = parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8"));
const missing = Object.entries(manifest.environment)
  .filter(([name, setting]) => setting.required && !values[name]?.trim() && setting.default === undefined)
  .map(([name]) => name);
if (missing.length) {
  console.error(`Missing required .env values: ${missing.join(", ")}. Nothing uploaded.`);
  process.exit(1);
}
for (const [name, setting] of Object.entries(manifest.environment)) {
  const value = values[name];
  if (!value?.trim()) {
    console.log(`Skipped ${name}: not set in .env; remote value/default preserved.`);
    continue;
  }
  // Secrets travel over stdin, never command-line arguments or console output.
  const args = ["app", setting.secret ? "secret" : "env", "set", appId,
    setting.secret ? name : `${name}=${value}`];
  const result = spawnSync("cantelop", args, {
    cwd: root, input: setting.secret ? value + "\n" : undefined,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60000,
  });
  if (result.error || result.status !== 0) {
    console.error(`Failed to upload ${name}. Earlier successful uploads remain applied. Check Cantelop login/connectivity and retry.`);
    process.exit(1);
  }
  console.log(`Uploaded ${name}${setting.secret ? " (secret)" : ""}`);
}
