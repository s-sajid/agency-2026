"""Orchestrator Lambda — three phases:

  1. Route — one LLM call to classify the question into one of six routes.
  2. Dispatch — invoke specialist Lambdas (sequential pipeline OR a single
     specialist, depending on the route).
  3. Finalize — for the pipeline route, deterministically compose a Final
     Brief from the structured outputs of Discovery + Investigation +
     Validator. No LLM, no invention.

Every step writes intermediate state into the DynamoDB job record so the
polling frontend (GET /status/:id served by App Runner) can re-render
progress in real time.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
from decimal import Decimal
from typing import Any

import boto3

from vendor_concentration_agent.agents import build_router_agent
from vendor_concentration_agent._jsonutil import extract_json
from vendor_concentration_agent.final_brief import build_final_brief


logger = logging.getLogger()
logger.setLevel(logging.INFO)

JOBS_TABLE = os.environ["JOBS_TABLE"]
DISCOVERY_FUNCTION = os.environ["DISCOVERY_FUNCTION"]
INVESTIGATION_FUNCTION = os.environ["INVESTIGATION_FUNCTION"]
VALIDATOR_FUNCTION = os.environ["VALIDATOR_FUNCTION"]
NARRATIVE_FUNCTION = os.environ["NARRATIVE_FUNCTION"]

dynamodb = boto3.resource("dynamodb")
lambda_client = boto3.client("lambda")
table = dynamodb.Table(JOBS_TABLE)


_OUT_OF_SCOPE = (
    "I'm built to answer questions about Canadian government vendor "
    "concentration — patterns of supplier dominance in federal and "
    "provincial procurement and grants. For other questions I can't help."
)

_NARRATION_NEEDS_CONTEXT = (
    "I can re-explain or summarize a prior finding, but there's nothing "
    "in this conversation yet to summarize. Try asking a substantive "
    "question first."
)


# ── DynamoDB helpers ───────────────────────────────────────────────────────────

def _to_ddb(value: Any) -> Any:
    """Recursively convert a Python value to DynamoDB-compatible types.

    DynamoDB rejects raw `float`; numeric values must be `Decimal`. NaN/Inf
    can't be stored either — replace with None. Everything else is passed
    through unchanged.
    """
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        # Decimal(str(...)) avoids float-binary repr noise like 0.1 -> 0.1000000...
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _to_ddb(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_ddb(v) for v in value]
    return value


def _set_status(job_id: str, status: str, **extra: Any) -> None:
    expr_names = {"#status": "status"}
    expr_values: dict[str, Any] = {":status": status}
    set_parts = ["#status = :status"]
    for k, v in extra.items():
        expr_names[f"#{k}"] = k
        expr_values[f":{k}"] = _to_ddb(v)
        set_parts.append(f"#{k} = :{k}")
    table.update_item(
        Key={"job_id": job_id},
        UpdateExpression="SET " + ", ".join(set_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )


def _append_events(job_id: str, events: list[dict]) -> None:
    if not events:
        return
    table.update_item(
        Key={"job_id": job_id},
        UpdateExpression=(
            "SET events = list_append(if_not_exists(events, :empty), :new)"
        ),
        ExpressionAttributeValues={":empty": [], ":new": _to_ddb(events)},
    )


def _merge_audit(job_id: str, audit: dict[str, dict]) -> None:
    if not audit:
        return
    # DynamoDB doesn't have a map-merge primitive in update expressions — so
    # set each call_id key under audit.<call_id>. We do this in one update.
    expr_values: dict[str, Any] = {}
    expr_names: dict[str, str] = {}
    set_parts: list[str] = []
    for i, (call_id, blob) in enumerate(audit.items()):
        # Strip enormous source_rows so the item stays under the 400 KB cap
        slim = dict(blob)
        if isinstance(slim.get("source_rows"), list):
            slim["source_rows"] = slim["source_rows"][:20]
        expr_names[f"#audit"] = "audit"
        expr_names[f"#cid{i}"] = call_id
        expr_values[f":blob{i}"] = _to_ddb(slim)
        set_parts.append(f"#audit.#cid{i} = :blob{i}")
    # Ensure audit map exists first
    table.update_item(
        Key={"job_id": job_id},
        UpdateExpression="SET audit = if_not_exists(audit, :empty)",
        ExpressionAttributeValues={":empty": {}},
    )
    table.update_item(
        Key={"job_id": job_id},
        UpdateExpression="SET " + ", ".join(set_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )


def _set_active(job_id: str, agents: list[str] | None) -> None:
    table.update_item(
        Key={"job_id": job_id},
        UpdateExpression="SET active_agent = :a",
        ExpressionAttributeValues={":a": agents},
    )


# ── Router (inline, no separate Lambda — Router has no tools) ──────────────────

VALID_ROUTES = {"pipeline", "discovery", "investigation", "validation", "narration", "out_of_scope"}


async def _classify(question: str, context: str) -> dict[str, str]:
    user_input = question if not context else f"Conversation so far:\n{context}\n\nLatest question:\n{question}"
    agent = build_router_agent()
    response = ""
    async for ev in agent.stream_async(user_input):
        if isinstance(ev, dict) and "data" in ev:
            response += ev["data"]
    parsed = extract_json(response) or {}
    raw = parsed.get("route", "pipeline")
    return {
        "route": raw if raw in VALID_ROUTES else "pipeline",
        "reason": parsed.get("reason", "default route on uncertain classification"),
    }


# ── Specialist invocation ──────────────────────────────────────────────────────

def _invoke(function_name: str, payload: dict) -> dict:
    response = lambda_client.invoke(
        FunctionName=function_name,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload),
    )
    body = json.loads(response["Payload"].read())
    if response.get("FunctionError"):
        raise RuntimeError(f"{function_name} failed: {body}")
    return body


def _run_specialist(job_id: str, function_name: str, payload: dict, agent_label: str) -> dict:
    _set_active(job_id, [agent_label])
    try:
        result = _invoke(function_name, payload)
    finally:
        _set_active(job_id, None)
    _append_events(job_id, result.get("events", []))
    _merge_audit(job_id, result.get("audit", {}))
    return result


# ── Dispatch ───────────────────────────────────────────────────────────────────

def _run_pipeline(job_id: str, question: str, context: str) -> dict:
    discovery = _run_specialist(
        job_id, DISCOVERY_FUNCTION,
        {"question": question, "context": context},
        "discovery",
    )

    investigation = _run_specialist(
        job_id, INVESTIGATION_FUNCTION,
        {"question": question, "context": context, "discovery_text": discovery.get("raw_text", "")},
        "investigation",
    )

    validator = _run_specialist(
        job_id, VALIDATOR_FUNCTION,
        {"question": question, "context": context, "investigation_text": investigation.get("raw_text", "")},
        "validator",
    )

    brief = build_final_brief(
        discovery.get("parsed") or {},
        investigation.get("parsed") or {},
        validator.get("parsed") or {},
    )

    final_event = {
        "kind": "tool_result",
        "payload": {"tool_result": True, "kind": "final_brief", "data": brief},
    }
    _append_events(job_id, [final_event])
    return {"final_brief": brief}


def _run_single(job_id: str, route: str, question: str, context: str) -> dict:
    fn_map = {
        "discovery": (DISCOVERY_FUNCTION, "discovery"),
        "investigation": (INVESTIGATION_FUNCTION, "investigation"),
        "validation": (VALIDATOR_FUNCTION, "validator"),
        "narration": (NARRATIVE_FUNCTION, "narrative"),
    }
    fn, label = fn_map[route]
    result = _run_specialist(job_id, fn, {"question": question, "context": context}, label)
    return {"specialist": label, "raw_text": result.get("raw_text", "")}


# ── SQS entry point ────────────────────────────────────────────────────────────

def handler(event, context):
    for record in event["Records"]:
        body = json.loads(record["body"])
        job_id = body["job_id"]
        message = body["message"]
        chat_context = body.get("context", "")
        logger.info("Job %s starting: %s", job_id, message[:120])

        try:
            _set_status(job_id, "running", events=[], audit={}, active_agent=["router"])

            decision = asyncio.run(_classify(message, chat_context))
            route = decision["route"]
            _append_events(job_id, [
                {"kind": "tool", "payload": {
                    "tool": "router", "label": "Router", "question": message[:80], "call_id": "router",
                }},
                {"kind": "tool_result", "payload": {
                    "tool_result": True, "kind": "route", "data": decision,
                }},
                {"kind": "tool_done", "payload": {"tool_done": "router"}},
            ])
            _set_active(job_id, None)

            if route == "pipeline":
                result = _run_pipeline(job_id, message, chat_context)
            elif route in ("discovery", "investigation", "validation"):
                result = _run_single(job_id, route, message, chat_context)
            elif route == "narration":
                if not chat_context.strip():
                    _append_events(job_id, [{"kind": "text", "payload": {"text": _NARRATION_NEEDS_CONTEXT}}])
                    result = {"text": _NARRATION_NEEDS_CONTEXT}
                else:
                    result = _run_single(job_id, "narration", message, chat_context)
            else:  # out_of_scope
                _append_events(job_id, [{"kind": "text", "payload": {"text": _OUT_OF_SCOPE}}])
                result = {"text": _OUT_OF_SCOPE}

            _set_status(job_id, "complete", result=result, route=decision)
            logger.info("Job %s complete (route=%s)", job_id, route)

        except Exception as e:
            logger.exception("Job %s failed", job_id)
            _set_status(job_id, "error", error=str(e), active_agent=None)
