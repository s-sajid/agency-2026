# App Runner image: pnpm-built static frontend + uv-managed FastAPI backend.
# Build from repo root:
#   docker build -t vendor-agent .
# Run locally:
#   docker run -p 8000:8000 --env-file .env vendor-agent

# ── Frontend: pnpm build → static export ──────────────────────────────────────
FROM node:20-alpine AS frontend-build
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY frontend/ ./
RUN pnpm build

# ── Backend: uv on python:3.12-slim ───────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

# Layer 1 — deps (cached unless pyproject changes)
COPY backend/pyproject.toml backend/uv.lock* ./
RUN uv sync --frozen 2>/dev/null || uv sync

# Layer 2 — backend source
COPY backend/server.py ./server.py
COPY backend/vendor_concentration_agent ./vendor_concentration_agent

# References registry lives at repo root
COPY references ./references

# Layer 3 — Next.js static export
COPY --from=frontend-build /app/out ./static

ENV PYTHONUNBUFFERED=1 \
    PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

CMD ["uv", "run", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
