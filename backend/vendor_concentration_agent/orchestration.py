"""In-process orchestrator — Modal/single-server replacement for the
Lambda orchestrator + specialist fan-out.

Same three phases as `orchestrator/handler.py`:

  1. Route — one LLM call (Router agent) to classify the question.
  2. Dispatch — call specialist agents in-process via `run_specialist`.
  3. Finalize — for the pipeline route, deterministically compose a
     Final Brief from Discovery + Investigation + Validator output.

Storage is decoupled. The caller passes a `JobSink` (any object with
`set_status`, `append_events`, `merge_audit`, `set_active`,
`save_notification` methods). server.py uses a SQLite-backed sink that
also pushes events to an asyncio.Queue for SSE streaming.
"""

from __future__ import annotations

import json
import logging
import textwrap
import uuid
from datetime import datetime, timezone
from typing import Any, Protocol

from vendor_concentration_agent._jsonutil import extract_json
from vendor_concentration_agent.agents import (
    build_discovery_agent,
    build_investigation_agent,
    build_narrative_agent,
    build_router_agent,
    build_validator_agent,
)
from vendor_concentration_agent.final_brief import build_final_brief
from vendor_concentration_agent.lambda_runtime import run_specialist_async


logger = logging.getLogger(__name__)

HHI_HIGH_THRESHOLD = 2500.0

VALID_ROUTES = {"pipeline", "discovery", "investigation", "validation", "narration", "out_of_scope"}

OUT_OF_SCOPE_MSG = (
    "I'm built to answer questions about Canadian government vendor "
    "concentration — patterns of supplier dominance in federal and "
    "provincial procurement and grants. For other questions I can't help."
)

NARRATION_NEEDS_CONTEXT_MSG = (
    "I can re-explain or summarize a prior finding, but there's nothing "
    "in this conversation yet to summarize. Try asking a substantive "
    "question first."
)


class JobSink(Protocol):
    def set_status(self, job_id: str, status: str, **extra: Any) -> None: ...
    def append_events(self, job_id: str, events: list[dict]) -> None: ...
    def merge_audit(self, job_id: str, audit: dict[str, dict]) -> None: ...
    def set_active(self, job_id: str, agents: list[str] | None) -> None: ...
    def save_notification(self, notification: dict[str, Any]) -> None: ...


# ── user_input builders (pulled from each Lambda handler) ────────────────────

def _discovery_input(question: str, context: str) -> str:
    return question if not context else f"Conversation context:\n{context}\n\nQuestion:\n{question}"


def _investigation_input(question: str, context: str, discovery_text: str) -> str:
    if discovery_text:
        return f"User question:\n{question}\n\nDiscovery plan:\n{discovery_text}"
    if context:
        return f"Conversation context:\n{context}\n\nQuestion:\n{question}"
    return question


def _validator_input(question: str, context: str, investigation_text: str) -> str:
    if investigation_text:
        return f"User question:\n{question}\n\nInvestigation findings:\n{investigation_text}"
    if context:
        return f"Conversation context:\n{context}\n\nQuestion:\n{question}"
    return question


def _narration_input(question: str, context: str) -> str:
    return question if not context else f"Conversation context:\n{context}\n\nQuestion:\n{question}"


def _paraphrase_input(question: str, discovery: dict, investigation: dict, validator: dict) -> str:
    return textwrap.dedent(f"""
        You are paraphrasing — NOT analysing. Write 2–3 short sentences that
        answer the user's question using ONLY values, names, and facts that
        appear verbatim in the structured data below.

        STRICT RULES (zero tolerance):
          • Do NOT introduce numbers, percentages, dollar amounts, vendor
            names, ministry names, category names, dates, or fiscal years
            that are not present in the structured data below.
          • Do NOT round, restate, or convert any value (e.g. don't turn an
            HHI of 10000 into "100%", don't shorten "Canada Revenue Agency"
            to "CRA").
          • Do NOT compute or infer new metrics. If a value is not in the
            data, do not state it.
          • Do NOT contradict the Validator verdict. If verdict is
            DIVERGE, INSUFFICIENT_DATA, or PARTIAL, your summary must
            reflect that hedge.
          • If the data does not support an answer to the user's question,
            say so plainly in one sentence.

        Output a JSON object and nothing else:
            {{"summary": "<2–3 sentences>"}}

        ── User question ──
        {question}

        ── Discovery (structured) ──
        {json.dumps(discovery, indent=2, ensure_ascii=False)}

        ── Investigation (structured) ──
        {json.dumps(investigation, indent=2, ensure_ascii=False)}

        ── Validator (structured) ──
        {json.dumps(validator, indent=2, ensure_ascii=False)}
    """).strip()


# ── Router ────────────────────────────────────────────────────────────────────

async def classify(question: str, context: str) -> dict[str, str]:
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


# ── Specialist runner ─────────────────────────────────────────────────────────

async def _run(job_id: str, sink: JobSink, name: str, factory, user_input: str, label: str) -> dict:
    """Run a specialist agent in-process. Sets active_agent, awaits the
    async run_specialist (which sets up its own BufferedBus), then
    merges the bus's events + audit into the job sink.
    """
    sink.set_active(job_id, [name])
    try:
        result = await run_specialist_async(name, factory, user_input, label[:80])
    finally:
        sink.set_active(job_id, None)
    sink.append_events(job_id, result.get("events", []))
    sink.merge_audit(job_id, result.get("audit", {}))
    return result


# ── Pipeline ──────────────────────────────────────────────────────────────────

async def _run_pipeline(job_id: str, sink: JobSink, question: str, context: str) -> dict:
    discovery = await _run(job_id, sink, "discovery", build_discovery_agent,
                           _discovery_input(question, context), question)

    investigation = await _run(job_id, sink, "investigation", build_investigation_agent,
                               _investigation_input(question, context, discovery.get("raw_text", "")),
                               question)

    validator = await _run(job_id, sink, "validator", build_validator_agent,
                           _validator_input(question, context, investigation.get("raw_text", "")),
                           question)

    narrative_summary = ""
    try:
        narrative = await _run(
            job_id, sink, "narrative", build_narrative_agent,
            _paraphrase_input(
                question,
                discovery.get("parsed") or {},
                investigation.get("parsed") or {},
                validator.get("parsed") or {},
            ),
            "paraphrasing findings",
        )
        # Strip the narrative agent's stale `final_brief` tool_result —
        # the orchestrator emits the real Final Brief card below.
        events = narrative.get("events", []) or []
        narrative["events"] = [
            e for e in events
            if not (e.get("kind") == "tool_result"
                    and (e.get("payload") or {}).get("kind") == "final_brief")
        ]
        narrative_summary = str((narrative.get("parsed") or {}).get("summary") or "").strip()
    except Exception as e:
        logger.warning("Narrative paraphrase failed; falling back to deterministic summary: %s", e)

    brief = build_final_brief(
        discovery.get("parsed") or {},
        investigation.get("parsed") or {},
        validator.get("parsed") or {},
        narrative_summary=narrative_summary,
    )

    events_to_append: list[dict] = [
        {"kind": "tool_result",
         "payload": {"tool_result": True, "kind": "final_brief", "data": brief}},
    ]
    if narrative_summary:
        events_to_append.append({"kind": "text", "payload": {"text": narrative_summary}})
    sink.append_events(job_id, events_to_append)
    return {"final_brief": brief}


async def _run_single(job_id: str, sink: JobSink, route: str, question: str, context: str) -> dict:
    if route == "discovery":
        result = await _run(job_id, sink, "discovery", build_discovery_agent,
                            _discovery_input(question, context), question)
        return {"specialist": "discovery", "raw_text": result.get("raw_text", "")}
    if route == "investigation":
        result = await _run(job_id, sink, "investigation", build_investigation_agent,
                            _investigation_input(question, context, ""), question)
        return {"specialist": "investigation", "raw_text": result.get("raw_text", "")}
    if route == "validation":
        result = await _run(job_id, sink, "validator", build_validator_agent,
                            _validator_input(question, context, ""), question)
        return {"specialist": "validator", "raw_text": result.get("raw_text", "")}
    if route == "narration":
        result = await _run(job_id, sink, "narrative", build_narrative_agent,
                            _narration_input(question, context), question)
        return {"specialist": "narrative", "raw_text": result.get("raw_text", "")}
    raise ValueError(f"unknown single-route: {route}")


# ── Notifications (scheduled scans only) ─────────────────────────────────────

def _high_hhi_findings(brief: dict) -> list[dict]:
    hits: list[dict] = []
    for m in (brief or {}).get("metrics_table") or []:
        name = str(m.get("metric") or "").lower()
        if "hhi" not in name:
            continue
        raw = str(m.get("value") or "").replace(",", "").strip()
        try:
            value = float(raw)
        except ValueError:
            continue
        if value > HHI_HIGH_THRESHOLD:
            hits.append({
                "metric": m.get("metric"),
                "value": value,
                "interpretation": m.get("interpretation"),
                "call_id": m.get("call_id"),
            })
    return hits


def _maybe_notify(sink: JobSink, job_id: str, scheduled: bool, question: str, brief: dict) -> None:
    if not scheduled or not brief:
        return
    hits = _high_hhi_findings(brief)
    if not hits:
        logger.info("Scheduled job %s found no high-HHI categories", job_id)
        return
    sink.save_notification({
        "notification_id": str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_job_id": job_id,
        "question": question,
        "headline": brief.get("headline"),
        "summary": brief.get("summary"),
        "verdict": brief.get("verdict"),
        "confidence": brief.get("confidence"),
        "sub_theme": brief.get("sub_theme"),
        "entity": brief.get("entity"),
        "hits": hits,
    })
    logger.info("Notification written for job %s (%d hit(s))", job_id, len(hits))


# ── Top-level entry point ─────────────────────────────────────────────────────

async def run_job(
    job_id: str,
    sink: JobSink,
    message: str,
    context: str = "",
    *,
    scheduled: bool = False,
) -> dict:
    """Run a full job to completion. Streams progress into `sink` as it
    goes; SSE consumers tail the sink. Returns the final result dict.
    """
    logger.info("Job %s starting (scheduled=%s): %s", job_id, scheduled, message[:120])
    sink.set_status(job_id, "running", active_agent=["router"])
    try:
        decision = await classify(message, context)
        route = decision["route"]
        sink.append_events(job_id, [
            {"kind": "tool", "payload": {
                "tool": "router", "label": "Router", "question": message[:80], "call_id": "router",
            }},
            {"kind": "tool_result", "payload": {
                "tool_result": True, "kind": "route", "data": decision,
            }},
            {"kind": "tool_done", "payload": {"tool_done": "router"}},
        ])
        sink.set_active(job_id, None)

        if route == "pipeline":
            result = await _run_pipeline(job_id, sink, message, context)
            _maybe_notify(sink, job_id, scheduled, message, result.get("final_brief") or {})
        elif route in ("discovery", "investigation", "validation"):
            result = await _run_single(job_id, sink, route, message, context)
        elif route == "narration":
            if not context.strip():
                sink.append_events(job_id, [{"kind": "text", "payload": {"text": NARRATION_NEEDS_CONTEXT_MSG}}])
                result = {"text": NARRATION_NEEDS_CONTEXT_MSG}
            else:
                result = await _run_single(job_id, sink, "narration", message, context)
        else:  # out_of_scope
            sink.append_events(job_id, [{"kind": "text", "payload": {"text": OUT_OF_SCOPE_MSG}}])
            result = {"text": OUT_OF_SCOPE_MSG}

        sink.set_status(job_id, "complete", result=result, route=decision)
        logger.info("Job %s complete (route=%s)", job_id, route)
        return result
    except Exception as e:
        logger.exception("Job %s failed", job_id)
        sink.set_status(job_id, "error", error=str(e), active_agent=None)
        raise
