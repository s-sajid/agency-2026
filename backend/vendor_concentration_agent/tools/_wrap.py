"""Internal helper: turn a MathResult into (LLM-friendly summary, audit blob,
chat-card payload).

The LLM only needs the headline value + interpretation hooks; the SQL and
source rows are voluminous and would just clog its context window. We send
the lean summary back to Strands (which forwards it to the model), stash
the full audit on the EventBus for /audit/:call_id, and emit a
{tool_result} event that the frontend renders as a structured card in the
chat thread.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from vendor_concentration_agent.math.types import MathResult
from vendor_concentration_agent.trace.events import current_bus


def _trim_rows(rows: list[dict], cap: int = 5) -> list[dict]:
    return rows[:cap]


def _trim_trace(steps: list[dict], cap: int = 10) -> list[dict]:
    return steps[:cap]


def _schedule(coro) -> None:
    """Schedule a coroutine on the running loop; silently no-op if called
    from a sync test context with no running loop.
    """
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        pass


def emit_audit_and_card(call_id: str, math_result: MathResult) -> None:
    """Push the full MathResult to (a) the audit store and (b) the chat
    thread as a structured card. No-op if no bus is set.
    """
    bus = current_bus()
    if bus is None:
        return

    audit = {
        "formula_id": math_result.formula_id,
        "value": math_result.value,
        "sql": math_result.sql,
        "source_rows": math_result.source_rows,
        "trace_steps": math_result.trace_steps,
        "references": math_result.references,
        "inputs": math_result.inputs,
    }
    _schedule(bus.emit_audit(call_id, audit))

    card_data = {
        "value": math_result.value,
        "inputs": math_result.inputs,
        "trace_preview": _trim_trace(math_result.trace_steps, cap=5),
        "rows_preview": _trim_rows(math_result.source_rows, cap=3),
        "references": math_result.references,
    }
    _schedule(bus.emit_tool_result(math_result.formula_id, card_data, call_id))


def summarize_for_llm(math_result: MathResult, call_id: str) -> dict[str, Any]:
    """Lean dict the LLM sees, plus side-effects: audit + chat card."""
    emit_audit_and_card(call_id, math_result)
    return {
        "call_id": call_id,
        "formula_id": math_result.formula_id,
        "value": math_result.value,
        "references": math_result.references,
        "inputs": math_result.inputs,
        "trace_preview": _trim_trace(math_result.trace_steps, cap=5),
        "rows_preview": _trim_rows(math_result.source_rows, cap=3),
        "row_count": len(math_result.source_rows),
    }


def new_call_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"
