"""Narrative specialist Lambda — used for the standalone `narration` route.

The pipeline route does NOT call this Lambda; pipeline mode composes the
final brief deterministically from upstream structured outputs (no LLM
invention possible).

Input:
    {"question": "...", "context": ""}
"""

from __future__ import annotations

import logging

from vendor_concentration_agent.agents import build_narrative_agent
from vendor_concentration_agent.lambda_runtime import run_specialist


logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    question = event.get("question", "")
    extra_context = event.get("context", "")
    user_input = question if not extra_context else f"Conversation context:\n{extra_context}\n\nQuestion:\n{question}"
    logger.info("Narrative: %s", question[:120])
    return run_specialist("narrative", build_narrative_agent, user_input, "writing the brief")
