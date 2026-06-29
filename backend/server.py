"""FastAPI app — single-process replacement for the App Runner + Lambda
deployment. Hosted on Modal (or any Python host) on the `deploy` branch.

  POST /chat                  → enqueue a job, return {job_id}
  GET  /chat/stream/{job_id}  → Server-Sent Events stream for that job
  GET  /status/{job_id}       → polled JSON snapshot (still used by the
                                notifications dossier modal)
  GET  /audit/{call_id}       → math-tool audit blob
  GET  /notifications         → list of high-HHI scan results
  GET  /dashboard/*           → local JSONL-backed dashboards
  GET  /health                → liveness probe

The orchestrator + 4 specialist agents run in-process via
`vendor_concentration_agent.orchestration.run_job`. Job state is
persisted to SQLite via `vendor_concentration_agent.jobstore`. Live
event streams are dispatched through an in-memory asyncio.Queue per
active job_id.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from vendor_concentration_agent import jobstore
from vendor_concentration_agent.dashboards import router as dashboards_router
from vendor_concentration_agent.jobstore import SqliteJobSink
from vendor_concentration_agent.orchestration import run_job

load_dotenv(override=True)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _prewarm_dashboards() -> None:
    """Pre-call every dashboard endpoint with default args so the cache
    is hot before the first user request lands. After a fresh container
    boot the L2 disk cache fills the L1 dict on first hit (cheap); on
    a truly cold boot (empty Volume / first-ever deploy) this pays the
    local aggregation cost once per endpoint, but keeps users out of
    that path entirely.

    Per-endpoint failures are logged and ignored so one flaky chart
    doesn't block the whole startup.
    """
    started = time.time()
    n_ok = 0
    n_fail = 0
    for route in dashboards_router.routes:
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None or not callable(endpoint):
            continue
        sig = inspect.signature(endpoint)
        if any(p.default is inspect.Parameter.empty for p in sig.parameters.values()):
            # Endpoint with required args — skip; we only warm defaults.
            continue
        try:
            result = endpoint()
            if inspect.iscoroutine(result):
                await result
            n_ok += 1
        except Exception as e:
            n_fail += 1
            logger.warning("Dashboard pre-warm failed for %s: %s",
                           getattr(route, "path", "?"), e)
    logger.info("Dashboard pre-warm complete: %d ok, %d fail in %.2fs",
                n_ok, n_fail, time.time() - started)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await _prewarm_dashboards()
    except Exception:
        logger.exception("Dashboard pre-warm raised; serving cold")
    yield


app = FastAPI(
    title="Vendor Concentration agent (Modal)",
    version="0.3.0",
    description="Agency 2026 — in-process SSE on free-tier hosting",
    lifespan=lifespan,
)

cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(dashboards_router)


# Match the server-side TTL (1h) and let the browser keep showing the
# cached chart while it revalidates in the background — avoids the
# blank-flash refresh experience.
_DASHBOARD_BROWSER_CACHE = "public, max-age=3600, stale-while-revalidate=86400"


@app.middleware("http")
async def add_dashboard_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/dashboard/"):
        response.headers.setdefault("Cache-Control", _DASHBOARD_BROWSER_CACHE)
    return response


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ── Live SSE dispatch ────────────────────────────────────────────────────────
#
# Per-job asyncio.Queue, populated by a sink wrapper. /chat/stream/:job_id
# replays the job's persisted events from SQLite first (so reconnects /
# late subscribers see the full history), then drains the live queue
# until the terminal status event arrives.

_active_streams: dict[str, asyncio.Queue] = {}


class _StreamingSink:
    """Wraps SqliteJobSink and publishes append_events / set_status
    transitions to the per-job asyncio.Queue. The wrapped store remains
    the source of truth so the SSE replay path can rebuild state on
    reconnect.
    """

    def __init__(self, inner: SqliteJobSink, queue: asyncio.Queue):
        self._inner = inner
        self._q = queue

    def set_status(self, job_id: str, status: str, **extra: Any) -> None:
        self._inner.set_status(job_id, status, **extra)
        self._q.put_nowait({
            "kind": "status",
            "payload": {
                "status": status,
                "result": extra.get("result"),
                "route": extra.get("route"),
                "error": extra.get("error"),
            },
        })

    def append_events(self, job_id: str, events: list[dict]) -> None:
        self._inner.append_events(job_id, events)
        for e in events:
            self._q.put_nowait(e)

    def merge_audit(self, job_id: str, audit: dict[str, dict]) -> None:
        self._inner.merge_audit(job_id, audit)

    def set_active(self, job_id: str, agents: list[str] | None) -> None:
        self._inner.set_active(job_id, agents)
        self._q.put_nowait({"kind": "active_agent", "payload": {"agents": agents}})

    def save_notification(self, notification: dict[str, Any]) -> None:
        self._inner.save_notification(notification)


# ── Prompt cache ──────────────────────────────────────────────────────────────
#
# Same idea as before: re-asking the same question reuses the prior
# job_id. Cache keyed by SHA-256 of (message + context). Lookup checks
# the SQLite jobstore for a terminal-state record.

_CHAT_CACHE_TTL_SECONDS = 60 * 60
_CHAT_CACHE_MAX_ENTRIES = 256
_chat_cache: dict[str, tuple[str, float]] = {}


def _hash_prompt(message: str, context: str) -> str:
    h = hashlib.sha256()
    h.update(message.strip().lower().encode("utf-8"))
    h.update(b"\n---\n")
    h.update(context.encode("utf-8"))
    return h.hexdigest()[:16]


def _cache_lookup(prompt_hash: str) -> str | None:
    hit = _chat_cache.get(prompt_hash)
    if not hit:
        return None
    cached_job_id, cached_at = hit
    if (time.time() - cached_at) > _CHAT_CACHE_TTL_SECONDS:
        _chat_cache.pop(prompt_hash, None)
        return None
    job = jobstore.get_job(cached_job_id)
    if not job:
        _chat_cache.pop(prompt_hash, None)
        return None
    if job.get("status") in ("complete", "error"):
        return cached_job_id
    return None


def _cache_store(prompt_hash: str, job_id: str) -> None:
    if len(_chat_cache) >= _CHAT_CACHE_MAX_ENTRIES:
        oldest = min(_chat_cache.items(), key=lambda kv: kv[1][1])
        _chat_cache.pop(oldest[0], None)
    _chat_cache[prompt_hash] = (job_id, time.time())


# ── Routes ────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    context: str = ""


class ChatResponse(BaseModel):
    job_id: str


@app.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest) -> ChatResponse:
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    prompt_hash = _hash_prompt(body.message, body.context)
    cached_job_id = _cache_lookup(prompt_hash)
    if cached_job_id:
        logger.info("Cache hit on prompt %s → job %s", prompt_hash, cached_job_id)
        return ChatResponse(job_id=cached_job_id)

    job_id = str(uuid.uuid4())
    sink = SqliteJobSink()
    sink.create_job(job_id, body.message, body.context)

    queue: asyncio.Queue = asyncio.Queue()
    _active_streams[job_id] = queue
    streaming_sink = _StreamingSink(sink, queue)

    async def _run():
        try:
            await run_job(job_id, streaming_sink, body.message, body.context)
        except Exception:
            logger.exception("run_job failed for %s", job_id)
        finally:
            queue.put_nowait({"kind": "_done"})

    asyncio.create_task(_run())
    _cache_store(prompt_hash, job_id)
    return ChatResponse(job_id=job_id)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@app.get("/chat/stream/{job_id}")
async def chat_stream(job_id: str) -> StreamingResponse:
    """Server-Sent Events stream of the job's events.

    Replays persisted events from SQLite first, then tails the live
    queue if the job is still running. Emits a terminal `status` event
    and closes when the orchestrator is done.
    """
    job = jobstore.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    queue = _active_streams.get(job_id)
    already_replayed = len(job.get("events") or [])

    async def _gen():
        # 1. Replay persisted events.
        for e in job.get("events") or []:
            yield _sse(e)
        if job.get("active_agent"):
            yield _sse({"kind": "active_agent", "payload": {"agents": job["active_agent"]}})
        if job.get("status") in ("complete", "error"):
            yield _sse({
                "kind": "status",
                "payload": {
                    "status": job["status"],
                    "result": job.get("result"),
                    "route": job.get("route"),
                    "error": job.get("error"),
                },
            })
            return

        # 2. Tail the live queue, skipping events we already replayed.
        if queue is None:
            # Job is in a non-terminal status but has no live queue —
            # probably a server restart. Close the stream; the client
            # can fall back to /status polling.
            yield _sse({"kind": "status", "payload": {"status": job.get("status") or "unknown"}})
            return

        seen = 0
        while True:
            try:
                ev = await asyncio.wait_for(queue.get(), timeout=30.0)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if ev.get("kind") == "_done":
                break
            # Skip any append_events the queue replayed that we already
            # streamed from SQLite (shouldn't happen if the client
            # connected before the first append, but defend anyway).
            if ev.get("kind") not in ("status", "active_agent"):
                seen += 1
                if seen <= already_replayed:
                    continue
            yield _sse(ev)
        _active_streams.pop(job_id, None)

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/status/{job_id}")
def status(job_id: str) -> dict[str, Any]:
    job = jobstore.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/audit/{call_id}")
def audit(call_id: str, job_id: str) -> dict[str, Any]:
    blob = jobstore.get_audit_blob(job_id, call_id)
    if blob is None:
        raise HTTPException(status_code=404, detail="Audit not found")
    return blob


@app.get("/notifications")
def notifications(limit: int = 25) -> dict[str, Any]:
    return jobstore.list_notifications(limit=limit)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
