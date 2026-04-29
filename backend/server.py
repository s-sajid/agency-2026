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

import json
import logging
import os
import time
import uuid
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


class ChatRequest(BaseModel):
    message: str
    context: str = ""


class ChatResponse(BaseModel):
    job_id: str


@app.post("/chat", response_model=ChatResponse)
def chat(body: ChatRequest) -> ChatResponse:
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    if not QUEUE_URL:
        raise HTTPException(status_code=500, detail="QUEUE_URL not configured")

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
    logger.info("Enqueued job %s", job_id)
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
