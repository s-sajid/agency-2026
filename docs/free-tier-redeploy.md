# Free-tier Redeploy — Architecture Changes

Reference doc for the `deploy` branch redeploy. The goal is to move off
AWS to a free / near-free stack while preserving the agent behaviour
documented in `architecture.md`. Only the **deployment topology** and a
few infrastructure-coupled code paths change; the agent design (Router →
specialists → deterministic Final Brief, math layer, references) is
untouched.

> **Status (2026-05-10):** the migration is shipped on the `deploy`
> branch and live in production. The plan below is preserved as a
> reference for the AWS → free-tier diff. Diffs from the original plan:
>
> - Auto-scan cron landed on **weekly** (`0 0 * * 1`, Mon 00:00 UTC)
>   instead of hourly — temporary cost control; the schedule string
>   lives in `backend/modal_deploy.py`.
> - The Modal entrypoint shipped as `backend/modal_deploy.py` (not
>   `modal_app.py` — same shape).
> - Added an L2 dashboard response cache (SQLite on the same Volume)
>   plus a lifespan pre-warm so cold containers don't hit Postgres on
>   first user request. This is on top of the L1 in-process dict
>   already present in `dashboards.py`.
> - `terraform/` and the Lambda-shaped folders (`backend/orchestrator/`,
>   `backend/{discovery,investigation,validator,narrative}_agent/`,
>   `backend/scheduler/`, `backend/scan_scheduler/`) are left in place
>   as archived reference, not deleted.

## Target stack

| Concern | Current (AWS) | Target (free tier) |
|---|---|---|
| Frontend host | App Runner serves Next.js static export under `/` | **Vercel** (Hobby tier, Next.js native) |
| Backend host | App Runner container (FastAPI) | **Modal** (Python-native serverless, no Dockerfile) |
| Orchestrator | Lambda, SQS-triggered, 15 min | Modal function, in-process |
| 4 specialists | 4 Lambdas, sync-invoked | In-process Python functions inside Modal |
| Job queue | SQS (910s visibility, DLQ) | In-process `asyncio` — no queue needed |
| Job state | DynamoDB `vendor-agent-jobs` (24h TTL) | **SQLite** file (or Modal volume) |
| Notifications | DynamoDB `vendor-agent-notifications` (7d TTL) | Same SQLite, separate table |
| Smoke test | EventBridge → Lambda → CloudWatch metric | Drop, or **UptimeRobot** free |
| Auto-scan scheduler | EventBridge → `scan_scheduler` Lambda → SQS | Modal `@app.function(schedule=...)` |
| Analytics Postgres | RDS read-only | **Neon** free tier (read-only) |
| LLM | Bedrock `openai.gpt-oss-120b` | **Ollama Cloud** `gemma4:31b-cloud` |
| IaC | Terraform (ECR, App Runner, SQS, Dynamo, Lambdas, EventBridge, IAM) | None — `vercel deploy` + `modal deploy` |

## Transport: polling → SSE (revert)

The upstream funding-loops repo used SSE. The AWS port switched to
DynamoDB polling because Lambda has no persistent connections. Modal
supports long-lived FastAPI responses, so we revert to SSE.

- `ChatEvent` shape (`text` / `tool` / `tool_done` / `tool_result`) is
  **unchanged**. The CLAUDE.md rule still holds.
- `lib/api.ts` flips from `setInterval(fetch /status/:id)` back to
  `new EventSource('/chat/stream')`.
- `ChatDrawer.tsx` — zero changes.
- `POST /chat` no longer returns `{job_id}`; it streams events directly.
  `GET /status/:id` and `GET /audit/:call_id` may stay for the
  notifications dossier modal (which reads historical jobs).

## What goes away

- `terraform/` — archive in place, do not delete (still useful as a
  reference for the AWS topology). Add `terraform/README.md` noting the
  AWS deployment is dormant.
- `backend/orchestrator/`, `backend/discovery_agent/`,
  `backend/investigation_agent/`, `backend/validator_agent/`,
  `backend/narrative_agent/` — each Lambda's `handler.py` collapses
  into a function call inside the Modal app. Their agent-building code
  (prompts, tool subsets, parsers) moves into
  `backend/vendor_concentration_agent/` if not already there.
- `backend/scheduler/` (CloudWatch smoke test) — drop.
- `backend/scan_scheduler/` — replaced by a Modal scheduled function.
- `backend/package_agents.py` — drop (no zips).
- DynamoDB / SQS / boto3 calls in `server.py` and orchestrator — replace
  with SQLite + asyncio.

## What stays unchanged

- `backend/vendor_concentration_agent/` — math layer, prompts, agents,
  references, `BufferedBus`, `tools/_wrap.py`. The contextvar pattern
  works identically in Modal.
- Final Brief composition (`final_brief.py`) — deterministic, no infra
  coupling.
- `references/references.json` — citations contract.
- `frontend/` — only `lib/api.ts` changes (poll → SSE) and the backend
  URL env var. ChatDrawer, dashboards, notifications bell all stay.

## LLM provider swap

Replace the Bedrock client (currently in the agents' Strands setup) with
an Ollama Cloud client targeting `gemma4:31b-cloud`. Strands SDK supports
custom model providers; we wire one that hits the Ollama Cloud endpoint
with the API key from env. Prompt caching semantics differ — verify that
the existing prompt-cache assumptions (see CLAUDE.md notes on the
narrative agent) still hold or are gracefully no-ops.

## Auto-scan & notifications

Modal scheduled function (`@app.function(schedule=modal.Cron("0 0 * * 1"))`)
runs weekly (planned hourly; throttled to weekly post-launch as a cost
control), calls the same in-process orchestrator with the synthetic
"find high-HHI categories" prompt, and writes to the `notifications`
SQLite table when HHI > 2500. Frontend bell polling is unchanged
(SSE is for chat only, not notifications).

## Environment

Single `.env` at repo root continues to be the source of truth. New
vars:

- `OLLAMA_CLOUD_API_KEY` — replaces Bedrock IAM role
- `NEON_DATABASE_URL` — replaces RDS connection string
- `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` — for `modal deploy`
- `VERCEL_TOKEN` — optional, for CLI deploys

Removed: AWS creds, ECR repo URL, all `*_LAMBDA_ARN` vars, SQS URL,
DynamoDB table names.

## Migration order

1. Branch `deploy` (done).
2. This doc (done).
3. Move agent-building code out of each Lambda's `handler.py` into
   `vendor_concentration_agent/` if any logic still lives in the Lambda
   handlers.
4. Add Ollama Cloud model provider; verify locally against one agent.
5. Add SQLite job store mirroring the DynamoDB schema (`events[]`,
   `audit{}`, `result`, `notifications`).
6. Write `backend/modal_app.py` — single Modal app exposing
   `POST /chat` (SSE), `GET /status/:id`, `GET /audit/:call_id`,
   `GET /dashboard/*`, `GET /notifications`, plus the hourly scan
   scheduled function.
7. Frontend: revert `lib/api.ts` to SSE; switch `NEXT_PUBLIC_BACKEND_URL`
   to the Modal URL; deploy to Vercel.
8. Archive `terraform/` with a README pointing at this doc.
9. Smoke test end-to-end against Neon.
10. Merge `deploy` → `main` once stable, or keep `deploy` as the live
    branch.

## Risks / open questions

- **Modal cold starts** for the LLM-heavy orchestrator may add a few
  seconds. Acceptable for a hackathon demo; mitigate with
  `keep_warm=1` if it shows.
- **Ollama Cloud `gemma4:31b-cloud` parity** with Bedrock
  `openai.gpt-oss-120b` is unknown. Some prompts may need adjustment;
  the deterministic math layer absorbs most of the risk.
- **Free-tier limits**: Modal $30/mo credits, Vercel Hobby bandwidth,
  Neon free Postgres compute. For a demo this is comfortable; for
  sustained traffic, revisit.
- **No DLQ** in the in-process model — a crash mid-job loses the job.
  Acceptable; SQLite row stays in `running` state and the user
  re-submits.
