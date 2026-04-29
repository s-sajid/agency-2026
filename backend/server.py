"""App Runner thin API.

  POST /chat            → enqueues a job, returns {job_id}
  GET  /status/:id      → polled by the frontend every 2s
  GET  /audit/:call_id  → math-tool audit (full SQL + source_rows)
  /dashboard/*          → read-only Postgres dashboards (existing router)
  /                     → Next.js static export (mounted last)

The agent code itself runs in Lambda, not here. This service is intentionally
boring: write a job to DynamoDB, push to SQS, return.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
import uuid
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from vendor_concentration_agent.dashboards import router as dashboards_router

load_dotenv(override=True)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

QUEUE_URL = os.getenv("QUEUE_URL", "")
JOBS_TABLE = os.getenv("JOBS_TABLE", "vendor-agent-jobs")
NOTIFICATIONS_TABLE = os.getenv("NOTIFICATIONS_TABLE", "vendor-agent-notifications")
AWS_REGION = os.getenv("AWS_REGION", "us-west-2")

sqs = boto3.client("sqs", region_name=AWS_REGION)
dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
table = dynamodb.Table(JOBS_TABLE)
notifications_table = dynamodb.Table(NOTIFICATIONS_TABLE)


app = FastAPI(
    title="Vendor Concentration agent (App Runner)",
    version="0.2.0",
    description="Agency 2026 — async polling architecture on AWS",
)

cors_origins = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(dashboards_router)


# Browser cache layer for the homepage charts. Pairs with the in-process
# TTL cache on each /dashboard/* route — server cache eats the Postgres
# round-trip; browser cache eats the network round-trip on warm reloads.
# 5 minutes matches the server-side TTL so the two layers expire together.
@app.middleware("http")
async def add_dashboard_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/dashboard/"):
        response.headers.setdefault("Cache-Control", "public, max-age=300")
    return response


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


class ChatRequest(BaseModel):
    message: str
    context: str = ""


class ChatResponse(BaseModel):
    job_id: str


# ── In-process prompt cache ───────────────────────────────────────────────────
#
# Re-asking the same question (same `message` + same `context`) shouldn't burn
# the entire pipeline again. We hash the prompt, remember the job_id we
# created for it, and on a repeat hit we return the prior job_id — the
# frontend polls /status/:id and immediately renders the cached result.
#
# The cache lives in App Runner process memory: lost on container restart,
# not shared across instances. For our 1-instance hackathon footprint that's
# fine; on a horizontal scale-out each instance just builds its own cache.

_CHAT_CACHE_TTL_SECONDS = 60 * 60  # 1 hour
_CHAT_CACHE_MAX_ENTRIES = 256

_chat_cache: dict[str, tuple[str, float]] = {}  # prompt_hash → (job_id, cached_at)
_chat_cache_lock = threading.Lock()


def _hash_prompt(message: str, context: str) -> str:
    """Stable cache key. Lowercase + trim the message so trivial whitespace
    or capitalization differences hit the same entry; keep `context` exact
    because it's already a structured serialisation of prior turns."""
    h = hashlib.sha256()
    h.update(message.strip().lower().encode("utf-8"))
    h.update(b"\n---\n")
    h.update(context.encode("utf-8"))
    return h.hexdigest()[:16]


def _cache_lookup(prompt_hash: str) -> str | None:
    """Return a cached job_id if (a) it's recent, (b) it still exists in
    DynamoDB, and (c) it's in a terminal state (`complete` or `error`).
    Otherwise return None and evict the stale entry."""
    with _chat_cache_lock:
        hit = _chat_cache.get(prompt_hash)
    if not hit:
        return None
    cached_job_id, cached_at = hit
    if (time.time() - cached_at) > _CHAT_CACHE_TTL_SECONDS:
        with _chat_cache_lock:
            _chat_cache.pop(prompt_hash, None)
        return None
    try:
        item = table.get_item(Key={"job_id": cached_job_id}).get("Item")
    except ClientError:
        return None
    status = (item or {}).get("status")
    if status in ("complete", "error"):
        return cached_job_id
    if not item:
        # The prior job TTL'd out of DDB — drop the cache entry.
        with _chat_cache_lock:
            _chat_cache.pop(prompt_hash, None)
    # `pending` / `running` falls through and creates a new job; we don't
    # coalesce in-flight requests because the orchestrator's idempotency
    # surface (DDB writes keyed by job_id) doesn't promise that.
    return None


def _cache_store(prompt_hash: str, job_id: str) -> None:
    with _chat_cache_lock:
        # Cheap eviction: if we're at the cap, drop the oldest entry.
        if len(_chat_cache) >= _CHAT_CACHE_MAX_ENTRIES:
            oldest = min(_chat_cache.items(), key=lambda kv: kv[1][1])
            _chat_cache.pop(oldest[0], None)
        _chat_cache[prompt_hash] = (job_id, time.time())


@app.post("/chat", response_model=ChatResponse)
def chat(body: ChatRequest) -> ChatResponse:
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    if not QUEUE_URL:
        raise HTTPException(status_code=500, detail="QUEUE_URL not configured")

    prompt_hash = _hash_prompt(body.message, body.context)

    # Re-asked? Reuse the prior job_id. Frontend polls /status/:id and gets
    # the cached complete result instantly — no Bedrock, no SQS, no Lambda.
    cached_job_id = _cache_lookup(prompt_hash)
    if cached_job_id:
        logger.info("Cache hit on prompt %s → job %s", prompt_hash, cached_job_id)
        return ChatResponse(job_id=cached_job_id)

    job_id = str(uuid.uuid4())
    table.put_item(Item={
        "job_id": job_id,
        "status": "pending",
        "message": body.message,
        "context": body.context,
        "events": [],
        "audit": {},
        "ttl": int(time.time()) + 86400,
    })
    sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps({
            "job_id": job_id,
            "message": body.message,
            "context": body.context,
        }),
    )
    _cache_store(prompt_hash, job_id)
    logger.info("Enqueued job %s (prompt %s)", job_id, prompt_hash)
    return ChatResponse(job_id=job_id)


def _from_ddb(value: Any) -> Any:
    """Recursively unwrap DynamoDB Decimals back to int/float so the JSON
    response uses native numeric types (the frontend chart components
    expect numbers, not strings)."""
    if isinstance(value, Decimal):
        # Decimal -> int when the value is a whole number, else float
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: _from_ddb(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_from_ddb(v) for v in value]
    return value


@app.get("/status/{job_id}")
def status(job_id: str) -> dict[str, Any]:
    try:
        item = table.get_item(Key={"job_id": job_id}).get("Item")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not item:
        raise HTTPException(status_code=404, detail="Job not found")
    # `audit` is intentionally omitted from the polling response — it can be
    # large, and the frontend only needs it on demand via /audit/:call_id.
    return _from_ddb({
        "job_id": job_id,
        "status": item.get("status"),
        "events": item.get("events", []),
        "active_agent": item.get("active_agent"),
        "result": item.get("result"),
        "route": item.get("route"),
        "error": item.get("error"),
    })


@app.get("/audit/{call_id}")
def audit(call_id: str, job_id: str) -> dict[str, Any]:
    """Fetch one math-tool audit blob. The frontend already has the call_id
    from the chat card; it knows the job_id from the polling cycle.
    """
    item = table.get_item(Key={"job_id": job_id}).get("Item")
    if not item:
        raise HTTPException(status_code=404, detail="Job not found")
    blob = (item.get("audit") or {}).get(call_id)
    if not blob:
        raise HTTPException(status_code=404, detail="Audit not found")
    return _from_ddb(blob)


@app.get("/notifications")
def notifications(limit: int = 25) -> dict[str, Any]:
    """List the most recent dummy notifications produced by the scheduled
    high-HHI scan. Newest first. The scan runs every 10 minutes via
    EventBridge → scan_scheduler Lambda → SQS → orchestrator pipeline →
    this table.
    """
    try:
        response = notifications_table.scan(Limit=max(1, min(limit, 100)))
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))
    items = _from_ddb(response.get("Items", []))
    items.sort(key=lambda i: i.get("created_at", ""), reverse=True)
    return {"items": items[:limit], "count": len(items)}


# Mount the Next.js static export last so it doesn't shadow API routes.
if os.path.exists("static"):
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory="static", html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
