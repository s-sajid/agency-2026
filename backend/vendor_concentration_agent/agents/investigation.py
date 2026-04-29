"""Investigation agent — runs the deterministic math, gathers findings."""

from __future__ import annotations

from strands import Agent

from vendor_concentration_agent.agents._base import load_prompt, shared_model
from vendor_concentration_agent.tools import INVESTIGATION_TOOLS


def build_investigation_agent() -> Agent:
    return Agent(
        model=shared_model(),
        system_prompt=load_prompt("investigation"),
        tools=INVESTIGATION_TOOLS,
        callback_handler=None,
    )
