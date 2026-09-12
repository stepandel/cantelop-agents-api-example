# Run a coding agent API on Cantelop

Deploy your own coding agent service on [Cantelop](https://cantelop.com), then use
its web console or HTTP API to give an agent tasks in your GitHub repositories,
stream its progress, and continue the same conversation across turns. You can
also have it pick up newly opened GitHub issues and post a summary when it finishes.

This repository is an example alternative to the managed
[OpenAI Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview).
Here, Cantelop runs the Edge API and durable Session workers, OpenCode runs the
agent, and OpenRouter provides model access. It exposes its own HTTP endpoints
and request format; it is not a drop-in replacement for the OpenAI API or SDK.
You do not need an OpenAI API key for this implementation.

Follow the steps below to run locally, complete your first task, and deploy to
Cantelop. GitHub webhooks and a searchable session database are optional.

## 1. Gather the prerequisites

You will need:

- **Node.js 22.12 or newer** and npm.
- **A Cantelop account and CLI.** Follow the CLI installation instructions in the
  [Cantelop documentation](https://console.cantelop.dev/docs), then run `cantelop login`.
- **Docker**, installed and running, for the local container and deployment image builds.
- **An OpenRouter API key** with access and sufficient credit for the model you choose.
- **A GitHub repository and fine-grained personal access token** scoped to the repositories
  you want the agent to work on, with **Contents: read and write** and **Issues: read and write**.
- **curl and jq** if you want to follow the command-line API examples. The web console
  does not require them.

This example is intended for **one trusted operator**. The API token gives access
to every configured repository and session. Agent tools run without approval
prompts and can edit files, execute commands, commit, push, and use the GitHub token.
Scope that token to the repositories you intend to expose. The repository allowlist
checks API requests; it does not isolate agent shell commands or the shared filesystem.

## 2. Install and configure the project

```sh
git clone https://github.com/stepandel/cantelop-agents-api-example.git
cd cantelop-agents-api-example
npm ci
cp .env.example .env
```

Edit `.env` with your own values. Keep this file private; it is already ignored by Git.

| Setting | What to put in it |
| --- | --- |
| `API_TOKEN` | A long random secret you choose. Use it to sign in to the console and authenticate API requests. |
| `GITHUB_TOKEN` | Your fine-grained GitHub token. |
| `GITHUB_WEBHOOK_SECRET` | A separate random secret. Required by the app configuration even if you have not enabled webhooks yet. |
| `GITHUB_REPOSITORIES` | A comma-separated list of allowed repositories, such as `your-name/your-repo,your-name/another-repo`. |
| `OPENROUTER_API_KEY` | Your OpenRouter API key. |
| `WORKSPACE_SLUG` | Keep `agents` for the initial setup. This identifies the shared durable workspace. |
| `GITHUB_ISSUE_MODEL` | The OpenRouter model ID for GitHub issue tasks. The included default is `moonshotai/kimi-k3`; change it to a model available to you. |
| `SESSION_DATABASE_URL` | Leave blank initially. Set it when enabling the optional session index. |
| `SESSION_DATABASE_AUTH_TOKEN` | Leave blank initially. Supply your database token when enabling the session index. |

You can generate a secret with the following command. Run it separately for
`API_TOKEN` and `GITHUB_WEBHOOK_SECRET`, and copy each result into `.env`:

```sh
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

For API-created sessions, you choose an **OpenRouter model ID** when starting each
session, for example `anthropic/claude-sonnet-4.5` if available to your account.
`GITHUB_ISSUE_MODEL` only supplies the default for issue tasks. Model IDs are strings,
not provider/model objects. The runtime checks the exact ID against OpenCode's
OpenRouter catalog and does not substitute another model. Follow-ups retain the
session's original model; start a new session to change it.

## 3. Start locally

```sh
npm run check
cantelop dev --container
```

Keep that terminal running. The container installs the pinned OpenCode version
(`1.18.30`) for you. If you choose to run `cantelop dev` without `--container`,
install `opencode-ai@1.18.30` globally first and make sure Git is available locally.

In another terminal, check that the API is reachable:

```sh
curl -fsS http://localhost:8787/health
```

You should see `{"status":"ok"}`. This checks the API process; your first agent
task will verify GitHub access and model credentials.

## 4. Run your first task in the web console

1. Open [http://localhost:8787/](http://localhost:8787/).
2. Open **Settings**, enter the `API_TOKEN` from `.env`, and save it.
3. Start a session with a repository from `GITHUB_REPOSITORIES`, an OpenRouter model
   ID available to you, and a prompt such as:

   > Explain this repository's architecture and how to run its tests. Do not modify files, commit, or push.

4. Watch the progress and wait for the final response. Keep the session ID so you
   can reopen the conversation later.
5. Send a follow-up using **Queue**, or use **Steer** to interrupt the current turn
   and continue with new instructions. **Stop** cancels the active turn.

When you are ready to have the agent make changes, ask it to implement a specific
change, run the relevant tests, and commit and push its agent branch. Each session
uses an `agent/SESSION_ID` branch. Review the resulting changes in GitHub; the
example does not automatically create pull requests or merge changes. A completed
turn alone does not prove a push succeeded—check the agent's response and the branch.

Use **Inspect** for the saved session and queue state. If you close the tab mid-turn,
reopen the session and use **Reconnect** or **Inspect**; disconnecting does not stop
the agent. The console stores your token, defaults, and locally streamed transcripts
in browser `localStorage`. **Forget token** clears the token; **Forget** on a session
removes only its local transcript.

Without a database, the sidebar shows sessions this browser started or opened by ID.
Enable the [optional session index](#optional-list-and-query-sessions) to browse
sessions across browsers and see tasks started by GitHub webhooks.

## 5. Deploy to Cantelop

Choose your own app slug and set the `app` field in `cantelop.json` to that value.
The manifest already points to the Edge API, Session worker, and Dockerfile;
you do not need to create another project with `cantelop init`.

Create the app using the same slug, or use an existing app you own:

```sh
cantelop login
cantelop app create -slug YOUR_APP_SLUG
cantelop app list
```

Copy the app ID (`app_…`) for that app. Upload the values you configured in `.env`:

```sh
npm run env:upload -- APP_ID
```

Replace `APP_ID` with the actual ID, not the app slug. The script sends secrets
through stdin to `cantelop app secret set` and ordinary variables to `cantelop app env set`.
It only uploads settings declared in `cantelop.json`, does not print their values,
and skips blank entries, preserving existing remote values. Missing required
local settings stop the upload before any changes. Uploads are sequential;
if one fails, correct the problem and rerun the command.

Validate and deploy:

```sh
cantelop doctor
cantelop deploy --dry-run
cantelop deploy
```

Local `.env` configuration is not automatically deployed by this guide's workflow;
repeat the upload step when changing production settings. Use the app URL reported
by Cantelop to open the console and repeat the first-task check with your production
`API_TOKEN`. Set that URL as `BASE_URL` when using the API examples below.

## Use the HTTP API

The console and your own client use the same endpoints. All routes except `/`,
`/health`, and the signed `/webhooks/github` endpoint require an
`Authorization: Bearer …` header.

The examples below use curl and jq. Set these variables in your terminal; editing
`.env` does not automatically export variables into your shell:

```sh
export BASE_URL='http://localhost:8787'
export API_TOKEN='YOUR_API_TOKEN'
export REPOSITORY='your-name/your-repo'
export MODEL='anthropic/claude-sonnet-4.5'
```

For production, replace `BASE_URL` with your deployed app URL, without a trailing
slash. Set `REPOSITORY` to an allowed repository and `MODEL` to a model available
to your OpenRouter account.

### Create a session and stream the response

```sh
request=$(curl -fsS "$BASE_URL/sessions" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg repository "$REPOSITORY" --arg model "$MODEL" \
    '{repository: $repository, model: $model, prompt: "Explain the architecture. Do not modify files, commit, or push."}')")

printf '%s\n' "$request" | jq .
export SESSION_ID=$(printf '%s' "$request" | jq -r .sessionId)
curl -N --fail-with-body "$BASE_URL$(printf '%s' "$request" | jq -r .stream)" \
  -H "Authorization: Bearer $API_TOKEN"
```

The creation request returns HTTP `202` with `sessionId`, `messageId`, `state`,
`stream`, and `events`. **202 means dispatch succeeded, not that the task finished.**
The `stream` URL follows that one request and closes on its terminal event.
The `events` URL is the session-wide stream; correlate its output by `messageId`.
Save `SESSION_ID` for follow-ups. Repeating `POST /sessions` creates a new conversation.

### Continue, steer, stop, or inspect a session

Queue a follow-up in the same conversation without resupplying the model:

```sh
request=$(curl -fsS "$BASE_URL/sessions/messages" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg id "$SESSION_ID" \
    '{sessionId: $id, mode: "queue", prompt: "Which tests cover the API routes?"}')")

curl -N --fail-with-body "$BASE_URL$(printf '%s' "$request" | jq -r .stream)" \
  -H "Authorization: Bearer $API_TOKEN"
```

Use `"mode": "steer"` to interrupt the active turn and run the new instruction ahead
of ordinary queued messages. Steering waits for runtime cleanup, then continues
the saved conversation. The interrupted request ends with `failed` and
`data.code: "turn_steered"`; edits and external effects already performed remain.
If idle, either mode starts immediately.

To stop the active turn or inspect the saved state:

```sh
curl -fsS "$BASE_URL/sessions/cancel" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg id "$SESSION_ID" '{sessionId: $id}')"

curl -fsS "$BASE_URL/sessions/inspect" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg id "$SESSION_ID" '{sessionId: $id}')"
```

Both return `202` and their own `stream` URL; subscribe as above to see the result.
Cancellation emits `cancelled`, with `data.cancelled` indicating whether an active
turn was interrupted. Cleanup continues asynchronously. Queued messages remain
saved and resume when another work message is dispatched.

Inspection emits `session` with the stored model, OpenCode conversation ID,
prompt, status, latest response, and a `messages` array of queued/running/finished
requests. Unknown sessions return only that array. Inspection does not wait for
the workspace lock and works without a database.

### Handle streaming events

Each SSE frame has a replay `id`, a named `event`, and a JSON `data` payload
containing `type`, `messageId`, optional `sessionId`, and event-specific `data`.
Platform sandbox IDs and transport envelopes are omitted on the turn endpoint.

| Event | Client behavior |
| --- | --- |
| `queued` | Keep waiting; the message is durably queued (`data.mode`). |
| `started` | Mark the turn active. |
| `status` | Show `data.phase`: workspace/checkout/startup, model validation, waiting for the model, or OpenCode busy/reasoning/retry/idle/error status. Retry events include a safe attempt count and next retry timestamp; errors include an allowlisted class and optional HTTP status. |
| `text.delta` | Append `data.text` to the text block identified by `data.partId`. |
| `text.replace` | Replace that block with `data.text` if OpenCode revises a snapshot. |
| `tool.status` | Show the tool name and pending/running/completed/error state. |
| `completed` | Use `data.response` as the authoritative final answer, not an additional delta. |
| `cancelled` | The stop request was handled; check `data.cancelled` to see whether an active turn was interrupted. |
| `failed` | Show the safe error/diagnostic; stop waiting. |

`ignored`, `configured`, and inspection `session` events also terminate their
request streams. Tool arguments/output, raw tool errors, and reasoning are not
forwarded. Reasoning is shown only as a “Model is reasoning” status, without its
contents. Runtime statuses and tool transitions are saved for inspection; runtime
statuses also appear in structured logs. `runtimeStatus` and `lastProgressAt` in
session snapshots survive event replay expiry. Idle/error status events are not
terminal; wait for `completed` or `failed` for the turn outcome. These diagnostics
apply to turns running the new release, not workers already running older code.
Assistant text can include intermediate explanations across multiple
blocks; keep blocks separate rather than concatenating all text into a final answer.

On disconnect, reconnect to the same URL with `Last-Event-ID: <last processed id>`;
use the IDs for deduplication. Replay availability follows Cantelop's retention
policy. Disconnecting only closes the subscription—it does not cancel the agent.
Close browser EventSource clients on terminal events to prevent automatic
reconnection. Fetch streaming is convenient for clients using Bearer headers.
An EOF without a terminal event is a transport interruption, not successful work.
The original `/events` endpoint remains an unmodified session-wide stream.

## Optional: start tasks from GitHub issues

Deploy the app first so GitHub can reach its webhook endpoint.

GitHub does not include an LLM model in issue events. `GITHUB_ISSUE_MODEL` defaults
to `moonshotai/kimi-k3` in `cantelop.json`. Set it in `.env` locally and
in Cantelop for production to change the default. No repository rule is required.

Optionally override the default for one repository **through the API**; wait for
its `configured` event:

```sh
curl -X PUT "$BASE_URL/github/issue-rules" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"repository":"your-name/your-repo","model":"anthropic/claude-sonnet-4.5"}'
```

In the repository's Settings → Webhooks, add:

- Payload URL: `https://YOUR_APP.cantelop.dev/webhooks/github`
- Content type: `application/json`
- Secret: the same value as `GITHUB_WEBHOOK_SECRET`
- Events: **Issues** and **Issue comments**

`issues.opened` starts a session; `issue_comment.created` continues that issue's
existing session. The raw body is verified with HMAC-SHA256;
unknown repositories are rejected. Only issues from `OWNER`, `MEMBER` and
`COLLABORATOR` authors initiate runs. Other authors/actions are ignored. If neither a repository rule nor
`GITHUB_ISSUE_MODEL` is available, the worker emits `ignored` without starting an
agent. Configure a model and redeliver the webhook to process it.

New comments from `OWNER`, `MEMBER`, or `COLLABORATOR` users queue follow-ups in
the issue's existing session, retaining its model and conversation. The comment's
author determines eligibility, independently of the original issue author.
Comments on issues without an existing session are ignored. Pull request comments,
bot comments, edited/deleted comments, and the app's own marked replies are ignored.
The app also recognizes its older `Cantelop session` replies to prevent loops when
the GitHub token belongs to a human user. Successful comment turns post a marked
summary back to the issue. Duplicate comment deliveries never rerun admitted work,
including failed or interrupted turns; post a new comment to request another try.

For existing installations, deploy this update and enable **Issue comments** in
the webhook settings. Old comments are not fetched automatically; post a new
comment or redeliver its original webhook after enabling support. Follow-ups also
remain available through the web console and `POST /sessions/messages`.

The worker asks OpenCode to implement, test, commit and push a fix on its agent
branch, then posts a summary comment on the issue. Updating the default or a rule affects future
issue sessions; existing sessions retain their original model. Creating a qualifying issue after enabling this webhook can trigger commits, pushes,
and an issue comment.

## Optional: list and query sessions

An optional shared libSQL database (for example, Turso) indexes session snapshots
for direct HTTP reads from the Edge API. Configure the **same** database URL,
auth token and `WORKSPACE_SLUG` for the API, workers and setup command:

```dotenv
SESSION_DATABASE_URL=libsql://YOUR-DATABASE.turso.io
SESSION_DATABASE_AUTH_TOKEN=YOUR-DATABASE-TOKEN
```

The implementation uses the HTTP-compatible [`@libsql/client/web` client](https://docs.turso.tech/sdk/http/quickstart),
so the database must be reachable over the network from both runtimes. A local
`file:` URL cannot be used by the Edge API. Each workspace has a separate index;
use a dedicated database per app, or distinct workspace slugs if sharing one.
Database credentials are excluded from the agent subprocess environment.

Create a database with your provider, set these variables in `.env`, then run:

```sh
npm run db:setup
```

This idempotently creates the table and indexes. Upload the two variables using
`npm run env:upload -- APP_ID` and deploy as usual. No database is provisioned or
deployed automatically. Without `SESSION_DATABASE_URL`, existing POST/SSE flows
continue to work and the new GET routes return `503`.

List session summaries (including API-created and GitHub issue sessions):

```sh
curl -G "$BASE_URL/sessions" \
  -H "Authorization: Bearer $API_TOKEN" \
  --data-urlencode 'repository=your-name/your-repo' \
  --data-urlencode 'status=completed' \
  --data-urlencode 'limit=20'
```

The response is `{ "sessions": [...], "nextCursor": "..." }`. Each summary contains
`sessionId`, `repository`, `model`, `status`, `promptPreview` (up to 200 characters),
`createdAt`, and `updatedAt`. Results sort by creation time descending, then session
ID descending. `repository` and `status` are optional; status is `running`,
`completed`, or `failed`. `limit` defaults to 50 and must be between 1 and 100.
Pass `nextCursor` as the URL-encoded `cursor` parameter with the same filters to
continue; `null` means no more results. Pagination is a live view, so status-filtered
results can change as turns finish.

Fetch the complete indexed snapshot, including the latest prompt, response,
OpenCode conversation ID and safe failure diagnostics:

```sh
curl -G "$BASE_URL/sessions/inspect" \
  -H "Authorization: Bearer $API_TOKEN" \
  --data-urlencode 'sessionId=SESSION_ID'
```

This returns `200` with `{ "session": {...} }`, or `404` for an ID not yet indexed.
Both GET routes require the existing operator Bearer token, disable response
caching, and return `400` for invalid queries or `503` when the database is
unconfigured/unavailable. No actor dispatch or SSE subscription is needed.
The existing `POST /sessions/inspect` still reads the durable workspace snapshot.

### Index timing, migration and recovery

Workspace JSON snapshots remain the recovery source. The worker writes JSON
first and then updates SQL at turn start, OpenCode conversation creation, completion
and failure. A session first becomes queryable after it acquires the workspace
lock and saves its running state; HTTP `202` does not imply it is already indexed.
Follow-ups update the same row and preserve the creation time. Streaming deltas
and per-turn history are not stored in the query index.

To import existing sessions or repair stale SQL rows after a database outage,
run the following **where the durable workspace is mounted**, with the same
configuration and this project's dependencies installed:

```sh
npm run db:setup -- /workspace
```

Backfill acquires the existing workspace lock, reads `.agent-api/sessions/*.json`,
and upserts them without running agents or reposting issue comments. It can be
safely rerun; older snapshots cannot overwrite newer indexed updates. Legacy
snapshots without timestamps use file modification time as an approximation and
save it for subsequent runs.

JSON and SQL are not one transaction. If SQL fails, the turn fails and the local
snapshot remains inspectable; an index write failure before checkout prevents
agent side effects, while a later failure cannot undo effects already performed.
The database may continue to show the last successfully indexed status until
backfill repairs it. Restore database connectivity and inspect the workspace
before retrying agent work. Abrupt process termination can still leave a session
marked `running`, as in the original receipt model.

For a deployed workspace, you can run the same backfill remotely:

```sh
curl -X POST "$BASE_URL/sessions/reindex" \
  -H "Authorization: Bearer $API_TOKEN"
```

Subscribe to the returned `stream` URL. A `configured` terminal event reports
`data.indexedSessions`; `failed` indicates the index could not be repaired.
This operation takes the workspace lock and only imports snapshots; it never
calls the agent or GitHub. Initialize the database schema before dispatching it.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `401 Unauthorized` | Use the `API_TOKEN` configured for this local or deployed app, not your Cantelop login token or GitHub token. |
| `Repository is not enabled` | Match `OWNER/REPO` against `GITHUB_REPOSITORIES`; upload changed settings for production. |
| Clone or push fails | Confirm the repository exists, the GitHub token includes it, and Contents permissions and branch protection permit the operation. |
| Model, authentication, credit, or rate-limit failure | Read the safe diagnostic in the stream or Inspect. Check `OPENROUTER_API_KEY`, account credit, and the exact model ID. Start a new session if its model was wrong. |
| A turn stays at “waiting for workspace” | Turns share one workspace and run serially. Check the active session; see recovery guidance below for a crashed worker's lock. |
| `GET /sessions` returns `503` | Configure the optional database, run `npm run db:setup`, and verify connectivity from both API and workers. POST/SSE flows work without the database. |
| A newly created session is missing from the index | Wait for it to acquire the workspace lock and save its running state. `202` does not mean it has been indexed yet. |
| The stream disconnects without a final event | Reconnect with the last event ID or inspect the session. EOF alone does not mean success. |

The trace UI receives structured JSON console logs with `component: agent-api`.
API rejections log at warning level and unexpected failures at error level, with
HTTP method, route, status and a safe reason code. Webhook decisions also include
available delivery ID, event/action, repository and issue number. Accepted and
ignored deliveries log at info level. Session dispatch, start and outcome logs
include message IDs so they can be correlated across API and runtime traces.
Logs omit credentials, signatures, prompts, issue titles/bodies and raw exception
messages. Live text and tool progress remain in session events rather than logs.

## Recovery and operating limits

- Receipts deduplicate by repository + issue number, including redeliveries with
  different delivery IDs. API messages deduplicate by Cantelop message ID; a second
  HTTP create request intentionally creates a new conversation.
- Admission is recorded before agent side effects. A crash leaves a `started`
  receipt, preventing automatic replay of potentially completed pushes/comments.
  This provides at-most-once admission, not guaranteed completion or exactly-once
  external effects. Inspect the workspace and GitHub before manually retrying.
- A provider/tool/comment failure emits `failed`, persists the session, and does
  not automatically replay. A follow-up API message can continue the conversation.
  A crash may leave the persisted status `running`; inspect before continuing.
- Lock acquisition waits until the current owner finishes or the waiting request
  is cancelled/times out. A crashed worker leaves `workspace.lock` behind; the lock
  is never expired automatically. Confirm the owning worker and all its tools have
  stopped before removing that directory. `owner.json` records the PID and time;
  a PID alone is not proof of liveness across containers.
- Uncommitted changes block another session from switching branches. Continue the
  owning session to commit or resolve them. No automatic reset or stash occurs.
- A completed result is persisted before posting an issue comment. A failed
  comment marks the command failed; the stored response remains available.
- Turns run as Cantelop activities with a 30-minute deadline (including time
  waiting for the shared workspace lock). Message admission returns promptly;
  a successful platform message receipt does not mean the coding turn completed.
  Read the application's `completed` / `failed` events or inspect saved state.
- Follow-ups queue by default, with up to 100 pending messages per session.
  A full queue emits `failed` with `data.code: "queue_full"`. HTTP 202 means
  dispatch succeeded; a `queued` event confirms durable queue admission.
  Inspection remains available while the workspace is locked.
- Pending messages survive restarts. The next work request resumes draining them.
  A previously running message is marked `turn_interrupted` in inspection and
  is never automatically replayed. Crash recovery does not remove stale workspace
  locks. Activity cancellation leaves pending messages saved for the next work request.
  Inbox history has no automatic retention cleanup.
- Failed turns persist safe diagnostics: phase, process exit code/signal and
  recognized stderr categories, plus recognized provider error categories and HTTP
  status codes. Model, authentication, credit and rate-limit failures include
  actionable messages. Raw provider errors and stderr are never logged or returned. A
  `SIGKILL` alone does not prove OOM. Activity cancellation persists failure when
  cleanup runs, but may prevent delivery of a final event; inspect the session.
  Abrupt VM/process termination still cannot guarantee cleanup or a final write.
- Git checkout failures include the operation, exit code/signal, and a safe
  category such as `branch_in_use`, `uncommitted_changes`, `git_locked`, or
  `git_auth`. Other command failures include the worker phase; GitHub comment
  rejections also include the HTTP status. Raw command arguments and stderr are
  not returned. These diagnostics describe new failures after deploying the update.
- This version has no automatic PR creation or state retention cleanup. The web
  console only reads and dispatches through the API.
- All sessions can see the shared filesystem. Agent instructions are guidance,
  not a security boundary. API/webhook secrets are excluded from subprocess env;
  OpenRouter and GitHub credentials must be available to the agent.

## How the example works

All requests use **one Cantelop Workspace** (`WORKSPACE_SLUG`, default `agents`).
Each API-created session gets a **distinct Cantelop Session actor**, using the API
session UUID as its actor ID. Follow-ups and event streams address that same ID.
Each actor owns a separate persisted OpenCode conversation.

An atomic filesystem lock at `.agent-api/workspace.lock` serializes complete turns
across actors sharing the workspace. It covers Git checkout, agent tools, receipts,
and state updates, preventing one session from switching another's active branch.
Issue deliveries use a deterministic actor ID per repository/issue; issue-rule
updates use temporary actors and take the same workspace lock.

- `src/api.ts`: authentication, input validation, webhook verification, dispatch, SSE.
- `src/ui.ts`: the single-page operator console served at `GET /`.
- `src/session.ts`: per-session Cantelop worker entry point and turn scheduling.
- `src/inbox.ts`: atomic durable message queue and turn outcomes.
- `src/lock.ts`: cross-process workspace lock with cancellable waiting.
- `src/worker.ts`: durable session models, issue rules, receipts and outcomes.
- `src/runtime.ts`: authenticated Git, shared checkouts, OpenCode lifecycle.
- `repositories/OWNER/REPO`: one shared clone per repository; `agent/SESSION_ID` branches.
- `.agent-api/`: conversation mappings, results, webhook receipts and OpenCode data.

OpenCode is started on loopback for each turn and stopped before the next turn.
Its persisted conversation ID is reused. The selected model is explicitly passed
to every prompt using the OpenCode SDK, because its session-create endpoint does
not select a model. The OpenRouter key is supplied separately to the subprocess. OpenCode enables
only OpenRouter and every prompt explicitly uses `providerID: "openrouter"`.

The runtime sets `permission: { "*": "allow", "question": "deny" }` for unattended
work. The interactive question tool is disabled because there is no question-answer
endpoint. Repository or agent-specific OpenCode configuration can override these
global permissions. Container permissions, GitHub token scopes, and branch
protections still apply.

## Develop and validate changes

```sh
npm run check
cantelop deploy --dry-run
```

`npm run check` runs TypeScript checking and the test suite. Tests use mocked
agent/GitHub dependencies and local Git without live model or GitHub calls.
The project pins `@cantelop/sdk@0.8.1` and `@opencode-ai/sdk@1.18.30`.

## Upgrading an older installation

### Coordinator actors

The original `agent-coordinator` actor must be idle before deploying this version:
its old code does not acquire the workspace lock. New requests do not use it.
Existing stored conversation IDs/models remain usable through their new per-ID
actors in the same workspace. Event subscriptions must now include `sessionId`;
there is no global event stream. Issue-rule updates return their own session ID
and event URL so their completion can be observed.

### OpenRouter-only request format

Session creation and issue-rule requests now take a model string, not a
`{ providerID, modelID }` object. Recreate any legacy sessions and update legacy
issue rules that stored that object before continuing them. API sessions take their model from
the request; issues use a repository rule or `GITHUB_ISSUE_MODEL`. The provider is
always OpenRouter.

### Follow-up stream recovery

The console saves a cursor per turn stream and uses the last observed session
cursor when opening a new turn. Reconnect retains the turn cursor. If Cantelop
returns `event_cursor_expired`, the console polls authenticated
`GET /turns/inspect?sessionId=…&messageId=…` for that exact turn's saved status and
terminal result. It never resubmits the prompt. Intermediate text lost to replay
expiry cannot be reconstructed; the final response is restored when available.

The optional session database now includes `agent_turns`. Run `npm run db:setup`
before deploying this update to an existing installation. Each turn is indexed
at admission, before waiting for the shared workspace, on status changes, and on
completion. A follow-up waiting behind another session is shown as waiting for
the shared workspace. Recovery requires the session database; without it, live
streams still work but expired replay cannot be recovered through this endpoint.
Older workers can recover their latest result from the existing session snapshot
once it matches the requested message; their pre-lock waiting state is not indexed.
