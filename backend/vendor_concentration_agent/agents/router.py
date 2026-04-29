"""Router agent — classifies the user's question into one of six routes."""

from __future__ import annotations

from strands import Agent

from vendor_concentration_agent.agents._base import load_prompt, shared_model


def build_router_agent() -> Agent:
    return Agent(
        model=shared_model(),
        system_prompt=load_prompt("router"),
        tools=[],  # classification only, no math
        callback_handler=None,  # we drive output via the EventBus, not stdout
    )
