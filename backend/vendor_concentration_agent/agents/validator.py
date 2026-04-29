"""Validator agent — cross-checks findings, returns MATCH / PARTIAL / DIVERGE."""

from __future__ import annotations

from strands import Agent

from vendor_concentration_agent.agents._base import load_prompt, shared_model
from vendor_concentration_agent.tools import VALIDATOR_TOOLS


def build_validator_agent() -> Agent:
    return Agent(
        model=shared_model(),
        system_prompt=load_prompt("validator"),
        tools=VALIDATOR_TOOLS,
        callback_handler=None,
    )
