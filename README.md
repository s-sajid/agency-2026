# Vendor Concentration — Agency 2026 (deployed)

Hackathon entry for **Challenge 5: Vendor Concentration**, packaged for
async deployment on AWS. Implementation vendored from
`../agency-2026-funding-loops/`; deployment shape mirrors
`../agency-prep-deploy/`.

## Architecture

Job-queue async, polled by the frontend:

```
Browser ── POST /chat ───────────▶  App Runner (FastAPI)
   │                                       │
   │                                       ├─ DynamoDB (vendor-agent-jobs)
   │                                       └─ SQS (vendor-agent-jobs)
   │                                                  │
   │                                                  ▼
   │                                  Orchestrator Lambda (15 min)
   │                                            │
   │                          (route → dispatch → finalize)
   │                                            │
   │      ┌───────────────────┬─────────────────┼──────────────────┐
   │      ▼                   ▼                 ▼                  ▼
   │  discovery-          investigation-    validator-         narrative-
   │   agent λ              agent λ          agent λ            agent λ
   │      │                   │                 │
   │      └─── tool_results, audit, parsed JSON ┘
   │                          │
   │                          ▼
   │                 DynamoDB (events, audit, result)
   │
   └── poll GET /status/:id every 1s ◀─── App Runner (FastAPI)
```

* **App Runner** — thin FastAPI service. `POST /chat` enqueues a job and
  returns `{job_id}`; `GET /status/:id` returns the appended event log.
  Also serves the Next.js static export under `/` and the read-only
  `/dashboard/*` Postgres endpoints used by the homepage charts.
* **Orchestrator Lambda** — SQS-triggered. Runs the Router (one Bedrock
  call, no tools), dispatches to specialist Lambdas (sequential pipeline
  for the `pipeline` route, single fan-out for the others), composes a
  deterministic Final Brief, writes everything into DynamoDB.
* **4 specialist Lambdas** — Discovery, Investigation, Validator,
  Narrative. Each builds the Strands agent it owns, runs it inside a
  `BufferedBus`, and returns `{parsed_json, raw_text, events, audit}`
  for the orchestrator to merge into the job record.
* **Smoke-test scheduler** — pings `/health` every 5 minutes and emits a
  CloudWatch metric (`vendor-agent/SmokeTest/Healthy`).

This is materially different from the SSE-streaming architecture in the
upstream funding-loops repo. See the difference summary at the bottom.

## Layout

```
agency-2026/
├── Dockerfile               App Runner image (pnpm build → static export, uv → uvicorn)
├── backend/
│   ├── server.py                       FastAPI (chat, status, audit, dashboards, static)
│   ├── pyproject.toml                  uv project for the App Runner image
│   ├── package_agents.py               builds linux/amd64 Lambda zips via Docker
│   ├── vendor_concentration_agent/     shared package — math, agents, tools, prompts, …
│   ├── orchestrator/handler.py         SQS entry; Router + dispatch + Final Brief
│   ├── discovery_agent/handler.py      thin wrapper over build_discovery_agent
│   ├── investigation_agent/handler.py
│   ├── validator_agent/handler.py
│   ├── narrative_agent/handler.py
│   └── scheduler/handler.py            CloudWatch smoke-test
├── frontend/                Next.js 16 app — `output: 'export'`, pnpm
├── references/              source-document registry (referenced by the validator)
├── terraform/               main.tf, variables.tf, terraform.tfvars.example
└── docs/                    architecture + judges briefing (vendored from funding-loops)
```

## Local development

```bash
# Backend
cp .env.example .env   # fill PG_DSN; AWS_* not needed for /dashboard
cd backend
uv sync
uv run uvicorn server:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
pnpm install
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000 pnpm dev
# http://localhost:3000
```

`POST /chat` requires `QUEUE_URL` + AWS creds for SQS — for pure
dashboard work it's optional. To exercise the chat path locally you'd
need to deploy the queue/Lambdas (or stub them in the orchestrator).

## Deploy

```bash
# 1. Build all Lambda zips (Docker required)
uv run backend/package_agents.py

# 2. Configure terraform vars
cd terraform
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars      # set pg_dsn at minimum

# 3. Apply
terraform init
terraform apply
# Outputs: service_url, ecr_repository_url, jobs_table_name, queue_url
```

Subsequent code-only updates:

* **Lambda change**: re-run `uv run backend/package_agents.py` then
  `terraform apply`.
* **App Runner change**: `terraform apply` rebuilds + pushes the image
  (the docker_image resource has `no_cache = true`).

## Differences from the funding-loops upstream

| Concern | funding-loops | this repo |
|---|---|---|
| Transport | SSE on `POST /chat` | `POST /chat → job_id`, poll `GET /status/:id` |
| Specialists | in-process (one Python proc) | 4 separate Lambdas |
| State sharing | per-request `EventBus` + contextvar | DynamoDB `events[]` + `audit{}` per job |
| Frontend | Next.js SSR + `/api/*` route handlers | static export, calls FastAPI directly |
| Frontend pkgmgr | npm | pnpm |
| Backend pkgmgr | pip + requirements.txt | uv per directory |
| Bedrock model | `us.anthropic.claude-sonnet-4-6` | `openai.gpt-oss-120b-1:0` |

The agent's *behaviour* (Router → 6 routes, Discovery/Investigation/Validator
sequential pipeline, deterministic Final Brief) is unchanged; only the
plumbing that connects those pieces moved out-of-process.
