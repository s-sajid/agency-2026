"""Narrative agent — writes the Minister-ready brief. No tools."""

from __future__ import annotations

from strands import Agent

from vendor_concentration_agent.agents._base import load_prompt, shared_model
from vendor_concentration_agent.tools import NARRATIVE_TOOLS


def build_narrative_agent() -> Agent:
    return Agent(
        model=shared_model(),
        system_prompt=load_prompt("narrative"),
        tools=NARRATIVE_TOOLS,  # empty — writing only
        callback_handler=None,
    )
