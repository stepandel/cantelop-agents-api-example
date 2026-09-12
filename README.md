# Cantelop + OpenCode agent API

A TypeScript scaffold with a Cantelop Edge API and an OpenCode worker. New
API conversations require a model in the request. GitHub issues use
`GITHUB_ISSUE_MODEL`, with optional per-repository overrides. GitHub access supports cloning, committing and pushing to
configured repositories. A signed `issues.opened` webhook starts an agent run and
posts its final summary to the issue.

## Architecture

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

## Setup

Prerequisites: Node 22.12+, the Cantelop CLI, Docker for image builds, and an
OpenRouter account. For non-container local development, install
`opencode-ai@1.18.30` globally. The Dockerfile already installs that version.

```sh
npm install
cp .env.example .env
# Edit .env with real secrets and repository names.
npm run check
cantelop dev --container
```

Use a **fine-grained GitHub personal access token** scoped to the selected user's
repositories, with Contents read/write and Issues read/write. Configure
`GITHUB_REPOSITORIES` as a comma-separated allowlist such as
`alice/app,alice/library`. Branch protection and token permissions still apply.
Git authenticates through subprocess environment configuration; tokens are never
embedded in clone URLs or written to Git config. The agent can also use
`GITHUB_TOKEN` for GitHub REST API access.

Set `OPENROUTER_API_KEY` from `.env.example`. Supply an OpenRouter model ID as
a string, for example `"model": "anthropic/claude-sonnet-4.5"`. Individual provider
keys and provider selection are not supported. An unavailable model fails the turn;
the scaffold never silently substitutes a different model.

For Kimi K3, enter `moonshotai/kimi-k3` (including `ai` in the organization).
The worker checks the exact ID against OpenCode's OpenRouter catalog before
creating or prompting a conversation. If a session was created with a wrong ID,
start a new session with the corrected model; follow-ups keep the original model.

This is a **single trusted operator** scaffold. One API token grants access to all
configured repositories and all session events. It does not implement per-user
OAuth, tenant isolation, or GitHub App installation-token refresh. For repositories
belonging to multiple unrelated users, add those boundaries before sharing access.
The repository allowlist validates API requests, but is not a sandbox for arbitrary
agent shell commands; scope the GitHub token accordingly.

## Web console

`GET /` serves a small single-page console for operating the API from a
browser. Open `http://localhost:8787/` during `cantelop dev` or your deployed
app URL, paste the `API_TOKEN` in **Settings**, then start a session with a
repository, an OpenRouter model ID and a prompt. The console streams the turn
(`status`, `text.delta`, `tool.status`, `completed` / `failed`), supports
follow-up prompts with separate **Queue** and **Steer** actions, a **Stop** button
for the active turn, **Inspect** for the stored session and queue snapshot, opening an
existing session by ID (for example an `issue-…` session), and setting a
per-repository GitHub issue model rule.

The sidebar lists every session in the shared session index (`GET /sessions`,
see [Querying sessions from clients](#querying-sessions-from-clients)), including
sessions started by the GitHub issue webhook, which show an issue badge and the
issue title. Filter by status, refresh, or load older pages; the list also
refreshes when a turn finishes and every 30 seconds while the tab is visible.
Opening a listed session loads its stored prompt, response and diagnostics from
the index. A turn started elsewhere cannot be streamed into this tab, so the
console polls the index until it finishes. Without `SESSION_DATABASE_URL` the
sidebar shows only sessions this browser started or opened by ID.

The page embeds no secrets and requires no authentication itself; every API
call it makes carries the token you entered as a `Bearer` header to the same
origin. Token, defaults and the transcripts streamed in this browser live in its
`localStorage` only (use **Forget token** to clear it; **Forget** on a session
drops only the local transcript). If the tab closes mid-turn, reopen the session
and use **Reconnect** or **Inspect**; disconnecting never cancels the agent.

## API

All routes except `/`, `/health` and `/webhooks/github` require
`Authorization: Bearer YOUR_API_TOKEN`. Commands return `202` after Cantelop
accepts them, **not after the agent completes**. Connect to the session-specific
`events` URL returned by dispatch and correlate output by `messageId`:

```sh
curl -N "http://localhost:8787/events?sessionId=SESSION_ID" \
  -H "Authorization: Bearer $API_TOKEN"
```

Create a new session (replace the example model with one available to you):

```sh
curl http://localhost:8787/sessions \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"repository":"alice/app","model":"anthropic/claude-sonnet-4.5","prompt":"Fix the failing tests, commit and push the agent branch."}'
```

The response includes `sessionId`, `messageId`, and `events`. Follow up without
resupplying the model:

```sh
curl http://localhost:8787/sessions/messages \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"SESSION_ID","prompt":"Add a regression test and push the update."}'
```

Follow-ups accept `"mode": "queue"` (the default) or `"mode": "steer"`:

```sh
curl http://localhost:8787/sessions/messages \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"SESSION_ID","mode":"steer","prompt":"Focus on the API tests first."}'
```

Queue mode runs messages in arrival order after the active turn. Steering saves
the new message, interrupts the active turn, waits for runtime cleanup, then runs
it ahead of ordinary queued messages using the same persisted OpenCode conversation
and model. Steering messages retain arrival order among themselves. If idle, either
mode starts immediately. Initial session creation is allowed to save its session
before interruption. Steering is interrupt-and-continue; it does not inject text
into a model response already being generated. The interrupted request terminates
with `failed` and `data.code: "turn_steered"`; edits and external side effects already
performed remain. Each queued/steering request has its own `messageId` and stream.
A failed turn does not discard the remaining queue. An interrupted issue run does
not post its completion comment.

Stop the active turn without discarding queued messages:

```sh
curl http://localhost:8787/sessions/cancel \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"SESSION_ID"}'
```

The cancel request emits a terminal `cancelled` event with
`data.cancelled: true` when it requested cancellation, or `false` when the
session was already idle. Agent cleanup continues asynchronously. Pending queued
messages remain saved and resume when another work message is dispatched.

To retrieve durable state after reconnecting, dispatch an inspection request:

```sh
curl http://localhost:8787/sessions/inspect \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"SESSION_ID"}'
```

It returns `202`; the correlated `session` event contains the stored model,
OpenCode ID, prompt, status and latest response. Its `messages` array includes
queued/running/finished message IDs, modes and terminal results; unknown sessions
return only that array.
Inspection reads an atomic saved snapshot without waiting for active work. Completion events
contain the response and branch name; they do not imply a push succeeded unless
the agent actually reports a verified push. There is no automatic merge.

## GitHub issue webhook

GitHub does not include an LLM model in issue events. `GITHUB_ISSUE_MODEL` defaults
to `moonshotai/kimi-k3` in `cantelop.json`. Set it in `.env` locally and
in Cantelop for production to change the default. No repository rule is required.

Optionally override the default for one repository **through the API**; wait for
its `configured` event:

```sh
curl -X PUT http://localhost:8787/github/issue-rules \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"repository":"alice/app","model":"anthropic/claude-sonnet-4.5"}'
```

In the repository's Settings → Webhooks, add:

- Payload URL: `https://YOUR_APP.cantelop.dev/webhooks/github`
- Content type: `application/json`
- Secret: the same value as `GITHUB_WEBHOOK_SECRET`
- Events: **Issues**

Only `issues.opened` is processed. The raw body is verified with HMAC-SHA256;
unknown repositories are rejected. Only issues from `OWNER`, `MEMBER` and
`COLLABORATOR` authors initiate runs. Other authors/actions are ignored. If neither a repository rule nor
`GITHUB_ISSUE_MODEL` is available, the worker emits `ignored` without starting an
agent. Configure a model and redeliver the webhook to process it.

The worker asks OpenCode to implement, test, commit and push a fix on its agent
branch, then posts a summary comment on the issue. Updating the default or a rule affects future
issue sessions; existing sessions retain their original model. No live GitHub
writes occur during scaffold tests or setup.

## Application logs

The trace UI receives structured JSON console logs with `component: agent-api`.
API rejections log at warning level and unexpected failures at error level, with
HTTP method, route, status and a safe reason code. Webhook decisions also include
available delivery ID, event/action, repository and issue number. Accepted and
ignored deliveries log at info level. Session dispatch, start and outcome logs
include message IDs so they can be correlated across API and runtime traces.
Logs omit credentials, signatures, prompts, issue titles/bodies and raw exception
messages. Live text and tool progress remain in session events rather than logs.

## Recovery and limits

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
- This version has no automatic PR creation or state retention cleanup. The web
  console only reads and dispatches through the API.
- All sessions can see the shared filesystem. Agent instructions are guidance,
  not a security boundary. API/webhook secrets are excluded from subprocess env;
  OpenRouter and GitHub credentials must be available to the agent.

## Deployment and validation

```sh
npm run check
cantelop doctor
cantelop deploy --dry-run
# Configure app environment/secrets with the Cantelop CLI, then:
cantelop deploy
```

Choose your Cantelop app name in `cantelop.json`. Production environment/secrets
must be configured on that app; local `.env` is not deployed. The test suite uses
mock agent/GitHub dependencies plus local Git, without live model or GitHub calls.

### Continuous deployment

`ci/deploy.yml` is a GitHub Actions workflow that runs `npm run check` and a
dry-run deployment build on every pull request and every push to `master`.
Pushes to `master` additionally deploy to the Cantelop app named in
`cantelop.json`. Deployments are serialized so concurrent merges cannot race
the app upload lock.

Activate it once by moving it into the workflows directory. Creating files
under `.github/workflows/` requires credentials permitted to manage Actions
workflows, so perform this step with your own account:

```sh
mkdir -p .github/workflows
git mv ci/deploy.yml .github/workflows/deploy.yml
```

One-time setup for the deploy job:

1. Create the app and configure its production environment once, for example
   with `cantelop deploy --create-app` and `npm run env:upload -- APP_ID`.
2. Run `cantelop login` locally, then copy the credential file it writes
   (`~/.config/cantelop/config.json`) into a GitHub Actions secret named
   `CANTELOP_CLI_CREDENTIALS`. The workflow stores it at the path named by
   `CANTELOP_CONFIG` with owner-only permissions; the credential is never
   printed.

The CLI refreshes the stored access token against the console when it expires.
If the console rotates or revokes the refresh token, deployments start failing
with a credential error; run `cantelop login` again and update the secret.

API references: [OpenCode SDK](https://opencode.ai/docs/sdk/) and
[GitHub webhook signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).
Cantelop calls are checked against the installed `@cantelop/sdk@0.8.1` types.

### Upgrading from the coordinator scaffold

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

### Unattended tool permissions

The runtime sets `permission: { "*": "allow", "question": "deny" }`. Tools run
without OpenCode approval prompts, including Bash, edits, external-directory
access and repeated tool calls. The interactive question tool is disabled because
this API has no question-answer endpoint. This does not change the container's OS
permissions, GitHub token scopes, or repository branch protections. Repository or
agent-specific OpenCode configuration can override global permissions.

### Upload local configuration

After filling in `.env`, upload its configured values with:

```sh
npm run env:upload -- app_a2d19af8c6749be1aa98227bf4165513
```

The script uses `cantelop.json` to send secrets through stdin to `cantelop app
secret set`, and ordinary variables to `cantelop app env set`. It does not print
values, upload undeclared settings, or overwrite remote values with blank entries.
Missing required local settings stop the upload before any changes. Uploads are
sequential, not atomic; retry the command if a later setting fails.

## Streaming a turn

Session creation and follow-up responses now include a `stream` URL alongside
`sessionId`, `messageId`, and the existing session-wide `events` URL. Subscribe to
`stream` for a clean SSE feed that closes when that request emits its terminal
result. API authentication is required on both endpoints.

```sh
request=$(curl -fsS https://cantelop-agents-api-example.cantelop.dev/sessions \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"repository":"stepandel/cantelop","model":"anthropic/claude-sonnet-4.5","prompt":"Explain the architecture. Do not modify files or push."}')
curl -N --fail-with-body "https://cantelop-agents-api-example.cantelop.dev$(printf '%s' "$request" | jq -r .stream)" \
  -H "Authorization: Bearer $API_TOKEN"
```

Each SSE frame has a replay `id`, a named `event`, and a JSON `data` payload
containing `type`, `messageId`, optional `sessionId`, and event-specific `data`.
Platform sandbox IDs and transport envelopes are omitted on the turn endpoint.

| Event | Client behavior |
| --- | --- |
| `queued` | Keep waiting; the message is durably queued (`data.mode`). |
| `started` | Mark the turn active. |
| `status` | Show `data.phase`: waiting for workspace, checkout, or agent startup. |
| `text.delta` | Append `data.text` to the text block identified by `data.partId`. |
| `text.replace` | Replace that block with `data.text` if OpenCode revises a snapshot. |
| `tool.status` | Show the tool name and pending/running/completed/error state. |
| `completed` | Use `data.response` as the authoritative final answer, not an additional delta. |
| `cancelled` | The stop request was handled; check `data.cancelled` to see whether an active turn was interrupted. |
| `failed` | Show the safe error/diagnostic; stop waiting. |

`ignored`, `configured`, and inspection `session` events also terminate their
request streams. Tool arguments/output, raw tool errors, and reasoning are not
forwarded. Assistant text can include intermediate explanations across multiple
blocks; keep blocks separate rather than concatenating all text into a final answer.

On disconnect, reconnect to the same URL with `Last-Event-ID: <last processed id>`;
use the IDs for deduplication. Replay availability follows Cantelop's retention
policy. Disconnecting only closes the subscription—it does not cancel the agent.
Close browser EventSource clients on terminal events to prevent automatic
reconnection. Fetch streaming is convenient for clients using Bearer headers.
An EOF without a terminal event is a transport interruption, not successful work.
The original `/events` endpoint remains an unmodified session-wide stream.

## Querying sessions from clients

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
curl -G http://localhost:8787/sessions \
  -H "Authorization: Bearer $API_TOKEN" \
  --data-urlencode 'repository=alice/app' \
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
curl -G http://localhost:8787/sessions/inspect \
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
curl -X POST https://YOUR_APP.cantelop.dev/sessions/reindex \
  -H "Authorization: Bearer $API_TOKEN"
```

Subscribe to the returned `stream` URL. A `configured` terminal event reports
`data.indexedSessions`; `failed` indicates the index could not be repaired.
This operation takes the workspace lock and only imports snapshots; it never
calls the agent or GitHub. Initialize the database schema before dispatching it.
