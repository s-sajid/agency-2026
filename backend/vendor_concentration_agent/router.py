"""Router: one cheap LLM call that classifies the user's question into one
of six routes. Returns a typed Decision. Used by the orchestrator to pick
which specialist(s) to dispatch.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from vendor_concentration_agent.agents import build_router_agent
from vendor_concentration_agent._jsonutil import extract_json

Route = Literal[
    "pipeline",
    "discovery",
    "investigation",
    "validation",
    "narration",
    "out_of_scope",
]

VALID_ROUTES: set[str] = {
    "pipeline", "discovery", "investigation",
    "validation", "narration", "out_of_scope",
}


@dataclass
class RouterDecision:
    route: Route
    reason: str
    raw: str


async def classify(question: str, context: str = "") -> RouterDecision:
    """Run the Router agent on the user's question; return a validated
    RouterDecision. Defaults to `pipeline` on any parse/route failure.
    """
    agent = build_router_agent()
    user_input = question if not context else f"Conversation so far:\n{context}\n\nLatest question:\n{question}"

    response = ""
    async for event in agent.stream_async(user_input):
        if isinstance(event, dict) and "data" in event:
            response += event["data"]

    parsed = extract_json(response) or {}
    route_raw = parsed.get("route", "pipeline")
    route = route_raw if route_raw in VALID_ROUTES else "pipeline"
    reason = parsed.get("reason", "default route on uncertain classification")
    return RouterDecision(route=route, reason=reason, raw=response)
