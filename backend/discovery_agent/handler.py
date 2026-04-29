"""Discovery specialist Lambda.

Input event (from orchestrator):
    {"question": "...", "context": ""}

Output:
    {"ok": bool, "name": "discovery", "parsed": {...}, "raw_text": "...",
     "events": [...], "audit": {call_id: {...}}, "final_text": ""}
"""

from __future__ import annotations

import logging

from vendor_concentration_agent.agents import build_discovery_agent
from vendor_concentration_agent.lambda_runtime import run_specialist


logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    question = event.get("question", "")
    extra_context = event.get("context", "")
    user_input = question if not extra_context else f"Conversation context:\n{extra_context}\n\nQuestion:\n{question}"
    logger.info("Discovery: %s", question[:120])
    return run_specialist("discovery", build_discovery_agent, user_input, question[:80])
