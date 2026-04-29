"""SSE event schema + per-request event bus.

Two display surfaces in the frontend, two kinds of payload:

  CHAT THREAD (left pane) — only the Narrative agent's prose streams
  here as {text} tokens, plus {tool_result} cards rendered between
  paragraphs for each math-tool call. Final user-visible answer.

  TRACE PANEL (right pane) — driven by {tool} / {tool_done} events,
  one card per agent (Router, Discovery, Investigation, Validator,
  Narrative). Compact step status, no flowing prose.

Wire format the frontend's lib/api.ts parses:

  {"text": "..."}                                     — append to chat
  {"tool": "...", "label": "...", "question": "..."}  — agent step start
  {"tool_done": "..."}                                 — agent step end
  {"tool_result": true, "kind": "...", "data": {...}, "call_id": "..."}
                                                      — render a card in chat
  {"error": "..."}                                     — fatal
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal


EventKind = Literal[
    "text", "tool", "tool_done", "tool_result", "error", "route", "audit",
]


@dataclass
class Event:
    kind: EventKind
    payload: dict[str, Any]


class EventBus:
    """Per-request queue of events. Producers (agents, tools, orchestrator)
    push; the /chat endpoint pulls and yields to the SSE response.

    Audit data is captured separately so /audit/:call_id can serve raw
    SQL + source_rows + trace_steps without re-running anything.
    """

    def __init__(self) -> None:
        self._q: asyncio.Queue[Event | None] = asyncio.Queue()
        self.audit: dict[str, dict[str, Any]] = {}

    async def emit(self, event: Event) -> None:
        if event.kind == "audit":
            call_id = event.payload["call_id"]
            self.audit[call_id] = event.payload
            return
        await self._q.put(event)

    async def emit_text(self, text: str) -> None:
        if not text:
            return
        await self.emit(Event("text", {"text": text}))

    async def emit_tool_start(self, name: str, label: str, question: str = "") -> str:
        call_id = f"{name}-{uuid.uuid4().hex[:8]}"
        await self.emit(Event("tool", {
            "tool": name, "label": label, "question": question, "call_id": call_id,
        }))
        return call_id

    async def emit_tool_done(self, name: str) -> None:
        await self.emit(Event("tool_done", {"tool_done": name}))

    async def emit_tool_result(
        self,
        kind: str,
        data: dict[str, Any],
        call_id: str | None = None,
    ) -> None:
        """Render a structured card in the chat thread. `kind` selects the
        renderer (e.g. "hhi", "categories", "discovery_plan", "verdict")."""
        payload: dict[str, Any] = {"tool_result": True, "kind": kind, "data": data}
        if call_id:
            payload["call_id"] = call_id
        await self.emit(Event("tool_result", payload))

    async def emit_error(self, message: str) -> None:
        await self.emit(Event("error", {"error": message}))

    async def emit_audit(self, call_id: str, audit: dict[str, Any]) -> None:
        await self.emit(Event("audit", {"call_id": call_id, **audit}))

    async def close(self) -> None:
        await self._q.put(None)

    async def __aiter__(self):
        while True:
            event = await self._q.get()
            if event is None:
                return
            yield event


class BufferedBus(EventBus):
    """Bus variant for Lambda execution: collects events into a flat list
    instead of an asyncio queue. Lambda runs an agent inside this bus, then
    calls `dump()` and returns the dict so the orchestrator can merge events
    + audit into DynamoDB. The frontend polls and re-renders from there.
    """

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self.audit: dict[str, dict[str, Any]] = {}
        self._final_text_parts: list[str] = []

    async def emit(self, event: Event) -> None:
        if event.kind == "audit":
            self.audit[event.payload["call_id"]] = event.payload
            return
        if event.kind == "text":
            self._final_text_parts.append(event.payload.get("text", ""))
        self.events.append({"kind": event.kind, "payload": event.payload})

    async def close(self) -> None:
        pass

    def dump(self) -> dict[str, Any]:
        return {
            "events": self.events,
            "audit": self.audit,
            "final_text": "".join(self._final_text_parts),
        }


# ---- per-request contextvar so deeply-nested tool functions can find it ----

_current_bus: contextvars.ContextVar[EventBus | None] = contextvars.ContextVar(
    "current_event_bus", default=None
)


def set_bus(bus: EventBus | None) -> contextvars.Token:
    return _current_bus.set(bus)


def reset_bus(token: contextvars.Token) -> None:
    _current_bus.reset(token)


def current_bus() -> EventBus | None:
    return _current_bus.get()
