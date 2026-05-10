# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working
with code in this repository.

## What this repo is

Hackathon entry for **Agency 2026 Challenge 5 — Vendor Concentration**,
running on a free-tier stack (Modal + Vercel + Ollama Cloud + Render
Postgres). The implementation is vendored from
`../agency-2026-funding-loops/`.

The repo was originally packaged for AWS (App Runner + Lambda + SQS +
DynamoDB) — that topology lives on the `main` branch and in the
`terraform/` + `backend/{orchestrator,*_agent,scheduler,scan_scheduler}/`
directories, kept as a reference. The **`deploy` branch** is the live
one and runs entirely in-process on Modal.

Source of truth for the agent's analytical design (formulas, prompts,
references, validator gates): `docs/architecture.md` and
`docs/judges-context.md`. Source of truth for the migration off AWS:
`docs/free-tier-redeploy.md`. Source of truth for the deployment
topology (Modal, Vercel, Ollama Cloud, SQLite-on-Volume): the
`README.md` at the repo root.

## Deployable units (deploy branch)

| Path | What | Stack |
|---|---|---|
| `backend/server.py` | FastAPI app — chat, SSE stream, status, audit, dashboards, notifications | FastAPI, uv |
| `backend/modal_deploy.py` | Modal entrypoint — `asgi_app` wrapping `server:app` + `scheduled_scan` cron | Modal SDK |
| `backend/vendor_concentration_agent/` | In-process orchestrator + 4 specialists + math layer + jobstore | Strands SDK, polars, connectorx |
| `frontend/` | Next.js 16 (native, no static export) → Vercel | pnpm |

The Lambda-shaped folders under `backend/` (`orchestrator/`,
`discovery_agent/`, `investigation_agent/`, `validator_agent/`,
`narrative_agent/`, `scheduler/`, `scan_scheduler/`) and the
`terraform/` tree are inherited from the AWS topology. They are not
exercised by the `deploy` build path; treat them as historical unless
you're explicitly working on the AWS variant.

## Transport

`POST /chat` returns `{job_id}` and kicks off `run_job` as an
`asyncio.create_task`. The browser opens an `EventSource` on
`GET /chat/stream/:job_id`; events are replayed from the SQLite job
record on connect, then tailed from a per-job `asyncio.Queue`. The
`ChatEvent` shape (`text` / `tool` / `tool_done` / `tool_result`) is
unchanged from the funding-loops upstream — the React layer never had
to learn the transport flipped from SSE → polling (on AWS) and back to
SSE (on Modal).

`GET /status/:job_id` and `GET /audit/:call_id` still exist for the
notification-dossier modal, which fetches a historical job snapshot
rather than streaming.

## Agent architecture (unchanged from funding-loops)

- **Router** (`vendor_concentration_agent.agents.router`) — classifies
  the question into 6 routes (`pipeline`, `discovery`, `investigation`,
  `validation`, `narration`, `out_of_scope`). One LLM call, no tools.
  Runs inline inside `orchestration.run_job` — no separate worker.
- **Specialists** — Discovery, Investigation, Validator, Narrative, each
  a Strands `Agent` with its own prompt and tool subset. They run as
  in-process `await`s inside the same `asyncio` task (`run_specialist_async`
  in `lambda_runtime.py`).
- **Math layer** (`backend/vendor_concentration_agent/math/`) — deterministic
  Python returning `MathResult` records (`value`, `sql`, `source_rows`,
  `trace_steps`, `formula_id`, `references`). Agents never invent numbers.
- **Final Brief** (`final_brief.py`) — composed deterministically from
  the parsed structured outputs of Discovery + Investigation + Validator.
  The `summary` field is the one LLM-paraphrased slot (Narrative in
  paraphrase mode, given the upstream JSON and told to use only values
  that appear verbatim); everything else is templated Python.

## Cross-Lambda state → in-process bus

`vendor_concentration_agent.trace.events.BufferedBus` is set on a
contextvar before each specialist runs, so the Strands `@tool` wrappers
in `tools/_wrap.py` capture math-tool cards (`tool` / `tool_result` /
`tool_done`) and audit blobs (`{call_id → {sql, source_rows, …}}`).
After the agent finishes, `run_specialist_async` dumps the bus and
returns `{parsed, raw_text, events, audit}`. The orchestrator merges
those into the SQLite `jobs` record *and* publishes them onto the
per-job `asyncio.Queue` so SSE consumers see progress in real time.

## Persistence — SQLite on a Modal Volume

`vendor_concentration_agent.jobstore.SqliteJobSink` writes to
`/data/vendor_agent.db` (the Modal Volume mount-point) in production,
or `backend/vendor_agent.db` locally. Three tables:

- `jobs` — `events[]`, `audit{}`, `active_agent`, `result`, status.
- `notifications` — high-HHI hits from scheduled scans (7-day TTL).
- `dashboard_cache` — L2 cache for the dashboard endpoints, survives
  rolling deploys. The dashboards decorator (`cached_dashboard` in
  `dashboards.py`) reads L1 (in-process dict) → L2 (SQLite) → Postgres.

`server.py` runs `_prewarm_dashboards()` on lifespan startup so the
first user after a cold container boot doesn't pay full Postgres latency.

## Auto-scan

`modal_deploy.py::scheduled_scan` runs on `modal.Cron("0 0 * * 1")` —
**weekly**, Mon 00:00 UTC. It was dropped from hourly to weekly as a
temporary cost control; flip the `schedule=` arg to dial it back up.
The scan synthesises a "find the most concentrated category" prompt
phrased to route to `pipeline` (so the Final Brief composes and
`_maybe_notify` can read `metrics_table` for HHI > 2500 hits) and
writes notifications via the same `SqliteJobSink`.

## Running

```bash
# Backend (FastAPI locally)
cd backend && uv sync && uv run uvicorn server:app --reload --port 8000

# Frontend
cd frontend && pnpm install && NEXT_PUBLIC_BACKEND_URL=http://localhost:8000 pnpm dev

# Deploy backend to Modal
cd backend && uv run modal deploy modal_deploy.py

# Trigger the auto-scan manually
cd backend && uv run modal run modal_deploy.py::scheduled_scan
```

Single `.env` at the repo root; copy `.env.example`. The deploy stack
needs `OLLAMA_CLOUD_API_KEY` + `PG_DSN`; Modal reads the rest from a
secret named `vendor-agent`.

## LLM provider

`vendor_concentration_agent.agents._base.shared_model()` is the single
cached model instance shared across the five Strands agents.
`LLM_PROVIDER=ollama` (default, `gemma4:31b-cloud` via Ollama Cloud)
is the deploy default; `LLM_PROVIDER=bedrock` (Claude Sonnet on AWS
Bedrock, model id `us.anthropic.claude-sonnet-4-6`) is the legacy path
retained so the AWS variant still works.

## What to never do

- Invent metrics. Only use textbook formulas (HHI, Gini, CR_n) or pure
  arithmetic. No `lockin_score`, no custom risk indices.
- Make context claims without a `reference_id` resolving in
  `references/references.json`. If no real source exists, drop the claim.
- Change the **shape** of `ChatEvent` (`text` / `tool` / `tool_done` /
  `tool_result`). The transport (SSE vs polling) is decoupled from the
  shape — funding-loops' "don't touch this contract" rule applies to
  the shape, not the wire format.
- Reach into Postgres outside
  `backend/vendor_concentration_agent/data/postgres.py` or
  `dashboards.py` (which uses its own `connectorx` URI for polars-shape
  dashboard reads). All non-dashboard DB access goes through the one
  read-only `psycopg2` helper.
- Use `npm` or `pip` for new code in this repo. Frontend uses `pnpm`,
  every Python project uses `uv` with its own `pyproject.toml`.
- Edit `frontend/` without reading `node_modules/next/dist/docs/` first —
  this is Next.js 16, not the Next.js your training data knows. See
  `frontend/AGENTS.md`.
