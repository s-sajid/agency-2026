"""Lambda-side runtime helpers.

Each specialist Lambda imports `run_specialist` and passes its agent factory.
We set a BufferedBus on the contextvar so tools/_wrap.py captures math-tool
cards and audit blobs into the bus rather than a no-op. After the agent
finishes we serialise the bus and return it; the orchestrator merges this
into the DynamoDB job record.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable

from vendor_concentration_agent._jsonutil import extract_json
from vendor_concentration_agent.trace.events import (
    BufferedBus,
    set_bus,
    reset_bus,
)


_LABELS = {
    "discovery": "Discovery",
    "investigation": "Investigation",
    "validator": "Validator",
    "narrative": "Narrative",
}

_KIND = {
    "discovery": "discovery_plan",
    "investigation": "findings",
    "validator": "verdict",
    "narrative": "final_brief",
}


async def _run(name: str, agent_factory: Callable, user_input: str, question_label: str) -> dict[str, Any]:
    bus = BufferedBus()
    token = set_bus(bus)
    try:
        await bus.emit_tool_start(name, _LABELS[name], question_label)
        agent = agent_factory()
        collected = ""
        try:
            async for event in agent.stream_async(user_input):
                if isinstance(event, dict) and "data" in event:
                    collected += event["data"]
        except Exception as e:
            await bus.emit_error(f"{name} failed: {type(e).__name__}: {e}")
            await bus.emit_tool_done(name)
            return {"ok": False, "error": str(e), **bus.dump()}

        parsed = extract_json(collected)
        payload = parsed if parsed is not None else {"raw_text": collected[:500]}
        await bus.emit_tool_result(_KIND[name], payload)
        await bus.emit_tool_done(name)

        return {
            "ok": True,
            "name": name,
            "raw_text": collected,
            "parsed": parsed,
            **bus.dump(),
        }
    finally:
        reset_bus(token)


def run_specialist(
    name: str,
    agent_factory: Callable,
    user_input: str,
    question_label: str = "",
) -> dict[str, Any]:
    """Synchronous entry point for Lambda handlers."""
    return asyncio.run(_run(name, agent_factory, user_input, question_label or name))
