"""Discovery agent — reframes the question and picks the scope."""

from __future__ import annotations

from strands import Agent

from vendor_concentration_agent.agents._base import load_prompt, shared_model
from vendor_concentration_agent.tools import DISCOVERY_TOOLS


def build_discovery_agent() -> Agent:
    return Agent(
        model=shared_model(),
        system_prompt=load_prompt("discovery"),
        tools=DISCOVERY_TOOLS,
        callback_handler=None,
    )
