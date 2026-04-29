# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this repo is

Hackathon entry for **Agency 2026 Challenge 5 — Vendor Concentration**,
packaged for asynchronous deployment on AWS. The implementation is
vendored from `../agency-2026-funding-loops/`; the deployment shape
mirrors `../agency-prep-deploy/`.

Source of truth for the agent's analytical design (formulas, prompts,
references): `docs/architecture.md` and `docs/judges-context.md`. Source
of truth for the deployment topology (queue, Lambdas, polling): the
`README.md` at the repo root.

## Deployable units

| Path | What | Stack |
|---|---|---|
| `backend/server.py` + Dockerfile | App Runner thin API + static frontend | FastAPI, uv, pnpm-built static export |
| `backend/orchestrator/` | Orchestrator Lambda (SQS-triggered, 15 min) | Strands SDK (Router only), boto3 |
| `backend/{discovery,investigation,validator,narrative}_agent/` | Specialist Lambdas (5 min) | Strands SDK, psycopg2 |
| `backend/scheduler/` | CloudWatch smoke-test Lambda | boto3 |
| `terraform/` | AWS infra (ECR, App Runner, SQS, DynamoDB, Lambdas, scheduler) | Terraform + the AWS + Docker providers |

## Transport

`POST /chat` returns `{job_id}`. The frontend polls `GET /status/:id`
every ~1s. The job record in DynamoDB carries an append-only `events: []`
list; `lib/api.ts` reconstructs the same `ChatEvent` shape ChatDrawer
already consumed (text / tool / tool_done / tool_result), so the chat UI
needed zero changes when SSE was replaced with polling.

The funding-loops upstream said *"Don't change this contract — the
frontend's `ChatDrawer.tsx` is built around it."* — that referred to the
SSE wire format. We changed the **transport** (SSE → poll) but kept the
**event shape** identical, so the rule is still honoured at the React
layer.

## Agent architecture (unchanged from funding-loops)

- **Router**: classifies the question into 6 routes (`pipeline`,
  `discovery`, `investigation`, `validation`, `narration`, `out_of_scope`).
  One LLM call, no tools. Runs **inside the Orchestrator Lambda** — no
  separate Router Lambda since it has no tools and a single LLM call.
- **Specialists**: Discovery, Investigation, Validator, Narrative — each
  a Strands `Agent` with its own prompt and tool subset, in its own
  Lambda.
- **Math layer** (`backend/vendor_concentration_agent/math/`): deterministic
  Python returning `MathResult` records (`value`, `sql`, `source_rows`,
  `trace_steps`, `formula_id`, `references`). Agents never invent numbers.
- **Final Brief**: composed deterministically by `final_brief.py` from the
  parsed structured outputs of Discovery + Investigation + Validator. No
  LLM, no invention possible.

## Cross-Lambda state

`vendor_concentration_agent.trace.events.BufferedBus` is the Lambda
analogue of the upstream `EventBus`. Each specialist Lambda runs its
agent inside a `BufferedBus` (set on the contextvar so `tools/_wrap.py`
captures math-tool cards + audit blobs). After the agent finishes, the
Lambda dumps the bus and returns it. The orchestrator merges the
`events[]` and `audit{}` into the DynamoDB job record so the polling
frontend can render progress.

## Running

```bash
# Backend (App Runner thin API + dashboards)
cd backend && uv sync && uv run uvicorn server:app --reload --port 8000

# Frontend
cd frontend && pnpm install && NEXT_PUBLIC_BACKEND_URL=http://localhost:8000 pnpm dev

# Build all Lambda zips for a deploy (Docker required)
uv run backend/package_agents.py

# Apply infra
cd terraform && terraform apply
```

Single `.env` at the repo root; copy `.env.example`.

## What to never do

- Invent metrics. Only use textbook formulas (HHI, Gini, CR_n) or pure
  arithmetic. No `lockin_score`, no custom risk indices.
- Make context claims without a `reference_id` resolving in
  `references/references.json`. If no real source exists, drop the claim.
- Change the **shape** of `ChatEvent` (text / tool / tool_done / tool_result).
  The transport (SSE vs polling) is decoupled from the shape.
- Reach into Postgres outside
  `backend/vendor_concentration_agent/data/postgres.py`. All DB access
  goes through one read-only connection helper.
- Use `npm` or `pip` for new code in this repo. Frontend uses `pnpm`,
  every Python project uses `uv` with its own `pyproject.toml`.
