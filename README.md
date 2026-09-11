# Cantelop + OpenCode agent API

A TypeScript scaffold with a Cantelop Edge API and an OpenCode worker. New
conversations require a model in the request; there is no model environment
variable or fallback. GitHub access supports cloning, committing and pushing to
configured repositories. A signed `issues.opened` webhook starts an agent run and
posts its final summary to the issue.

## Architecture

All requests use **one Cantelop Workspace** (`WORKSPACE_SLUG`, default `agents`)
and **one Cantelop Session actor** (`agent-coordinator`). That actor awaits each
complete turn, serializing work across separate OpenCode conversation sessions.
This avoids racing Git branch changes in the shared checkout. API session IDs
refer to these logical OpenCode conversations, not separate Cantelop actors.

- `src/api.ts`: authentication, input validation, webhook verification, dispatch, SSE.
- `src/session.ts`: serialized Cantelop worker entry point.
- `src/worker.ts`: durable session models, issue rules, receipts and outcomes.
- `src/runtime.ts`: authenticated Git, shared checkouts, OpenCode lifecycle.
- `repositories/OWNER/REPO`: one shared clone per repository; `agent/SESSION_ID` branches.
- `.agent-api/`: conversation mappings, results, webhook receipts and OpenCode data.

OpenCode is started on loopback for each turn and stopped before the next turn.
Its persisted conversation ID is reused. The selected model is explicitly passed
to every prompt using the OpenCode SDK, because its session-create endpoint does
not select a model. Provider keys are supplied separately to the subprocess.

## Setup

Prerequisites: Node 22.12+, the Cantelop CLI, Docker for image builds, and an
OpenCode-supported provider account. For non-container local development, install
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

Set at least one supported provider key from `.env.example`. Use a provider/model
pair available to that account; an unavailable model fails the turn. The scaffold
never silently substitutes a different model.

This is a **single trusted operator** scaffold. One API token grants access to all
configured repositories and all session events. It does not implement per-user
OAuth, tenant isolation, or GitHub App installation-token refresh. For repositories
belonging to multiple unrelated users, add those boundaries before sharing access.
The repository allowlist validates API requests, but is not a sandbox for arbitrary
agent shell commands; scope the GitHub token accordingly.

## API

All routes except `/health` and `/webhooks/github` require
`Authorization: Bearer YOUR_API_TOKEN`. Commands return `202` after Cantelop
accepts them, **not after the agent completes**. Start an SSE connection first and
correlate output by `messageId`:

```sh
curl -N http://localhost:8787/events \
  -H "Authorization: Bearer $API_TOKEN"
```

Create a new session (replace the example model with one available to you):

```sh
curl http://localhost:8787/sessions \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"repository":"alice/app","model":{"providerID":"anthropic","modelID":"claude-sonnet-4-5"},"prompt":"Fix the failing tests, commit and push the agent branch."}'
```

The response includes `sessionId`, `messageId`, and `events`. Follow up without
resupplying the model:

```sh
curl http://localhost:8787/sessions/messages \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"SESSION_ID","prompt":"Add a regression test and push the update."}'
```

To retrieve durable state after reconnecting, dispatch an inspection request:

```sh
curl http://localhost:8787/sessions/inspect \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"SESSION_ID"}'
```

It returns `202`; the correlated `session` event contains the stored model,
OpenCode ID, prompt, status and latest response (or `null` for an unknown session).
Inspection shares the queue and therefore waits for active work. Completion events
contain the response and branch name; they do not imply a push succeeded unless
the agent actually reports a verified push. There is no automatic merge.

## GitHub issue webhook

GitHub does not include an LLM model in issue events. Configure a per-repository
rule **through the API** first; wait for its `configured` event:

```sh
curl -X PUT http://localhost:8787/github/issue-rules \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"repository":"alice/app","model":{"providerID":"anthropic","modelID":"claude-sonnet-4-5"}}'
```

In the repository's Settings → Webhooks, add:

- Payload URL: `https://YOUR_APP.cantelop.dev/webhooks/github`
- Content type: `application/json`
- Secret: the same value as `GITHUB_WEBHOOK_SECRET`
- Events: **Issues**

Only `issues.opened` is processed. The raw body is verified with HMAC-SHA256;
unknown repositories are rejected. Only issues from `OWNER`, `MEMBER` and
`COLLABORATOR` authors initiate runs. Other authors/actions are ignored. A missing
model rule produces an `ignored` event and no agent run. Once the rule exists,
redeliver the webhook to process it.

The worker asks OpenCode to implement, test, commit and push a fix on its agent
branch, then posts a summary comment on the issue. Updating a rule affects future
issue sessions; existing sessions retain their original model. No live GitHub
writes occur during scaffold tests or setup.

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
- Uncommitted changes block another session from switching branches. Continue the
  owning session to commit or resolve them. No automatic reset or stash occurs.
- A completed result is persisted before posting an issue comment. A failed
  comment marks the command failed; the stored response remains available.
- Turns have a 30-minute application timeout, also subject to Cantelop runtime
  deadlines. This version has no live token stream, cancellation endpoint, UI,
  automatic PR creation, or state retention cleanup.
- All sessions can see the shared filesystem. Agent instructions are guidance,
  not a security boundary. API/webhook secrets are excluded from subprocess env;
  provider and GitHub credentials must be available to the agent.

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

API references: [OpenCode SDK](https://opencode.ai/docs/sdk/) and
[GitHub webhook signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).
Cantelop calls are checked against the installed `@cantelop/sdk@0.8.0` types.
