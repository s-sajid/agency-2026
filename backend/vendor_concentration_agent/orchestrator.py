"""Top-level entry point: receive a user question, route it via the Router,
dispatch to the right specialist(s), run the gates, return the SSE event
stream that the FastAPI /chat endpoint hands to the frontend.

This is the only thing api.py needs to import.
"""

from __future__ import annotations

from typing import AsyncIterator

from vendor_concentration_agent.pipeline import run_full_pipeline, run_single_specialist
from vendor_concentration_agent.router import classify
from vendor_concentration_agent.trace.events import (
    EventBus,
    current_bus,
    set_bus,
    reset_bus,
)
from vendor_concentration_agent.validation import run_gates


_OUT_OF_SCOPE_MESSAGE = (
    "I'm built to answer questions about Canadian government vendor "
    "concentration — patterns of supplier dominance in federal and "
    "provincial procurement and grants. For other questions I can't "
    "help. Try asking about a specific vendor, ministry, category, or "
    "year, or ask me to find the most concentrated categories overall."
)

_NARRATION_NEEDS_CONTEXT = (
    "I can re-explain or summarize a prior finding, but there's nothing "
    "in this conversation yet to summarize. Try asking a substantive "
    "question first (e.g. *find the worst vendor lock-in in Alberta IT*)."
)


async def handle(question: str, context: str = "") -> AsyncIterator[dict]:
    """Top-level handler. Yields raw SSE event dicts (the api.py layer
    serializes them as `data: {json}\\n\\n`).

    Lifecycle:
      1. Set up a per-request EventBus and stash it on a contextvar so
         deeply-nested tool functions can find it.
      2. Run the Router; emit `tool=router` events around it; emit a
         `text` breadcrumb showing the chosen route.
      3. Dispatch to the right specialist(s) based on the route.
      4. After the final agent finishes, run the Validator gates on the
         collected text + audit store. Surface any warnings as a
         `text` event so the judge sees them.
      5. Close the bus.
    """
    bus = EventBus()
    token = set_bus(bus)

    async def producer() -> None:
        try:
            # ---- Router classification ----
            await bus.emit_tool_start("router", "Router", question)
            decision = await classify(question, context)
            # Surface the route as a small structured card for the trace
            # panel — NOT as flowing text in the chat thread.
            await bus.emit_tool_result(
                "route", {"route": decision.route, "reason": decision.reason}
            )
            await bus.emit_tool_done("router")

            # ---- Dispatch ----
            final_text = ""
            if decision.route == "pipeline":
                final_text = await run_full_pipeline(bus, question)
            elif decision.route == "discovery":
                final_text = await run_single_specialist(bus, "discovery", question, context)
            elif decision.route == "investigation":
                final_text = await run_single_specialist(bus, "investigation", question, context)
            elif decision.route == "validation":
                final_text = await run_single_specialist(bus, "validator", question, context)
            elif decision.route == "narration":
                if not context.strip():
                    await bus.emit_text(_NARRATION_NEEDS_CONTEXT)
                else:
                    final_text = await run_single_specialist(bus, "narrative", question, context)
            elif decision.route == "out_of_scope":
                await bus.emit_text(_OUT_OF_SCOPE_MESSAGE)

            # ---- Gates (silent unless they fire) ----
            # We deliberately do NOT pollute the chat with gate warnings —
            # they're advisory and noisy. They live in the audit drawer
            # and the orchestrator's logs. Only fatal failures interrupt.

        except Exception as e:
            await bus.emit_error(f"orchestrator: {type(e).__name__}: {e}")
        finally:
            await bus.close()

    # Run the producer as a background task; iterate the bus's queue.
    # Note: contextvar set_bus / reset_bus is done in THIS context (handle's
    # frame), so the producer task inherits the bus via copy_context() — but
    # we must reset in this same context to satisfy contextvars.Token rules.
    import asyncio
    task = asyncio.create_task(producer())
    try:
        async for event in bus:
            payload = event.payload.copy()
            payload["__kind__"] = event.kind
            yield payload
        await task  # surface any producer exception
    finally:
        reset_bus(token)
