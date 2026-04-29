"""Investigation specialist Lambda.

Input:
    {"question": "...", "context": "", "discovery_text": "<plan from Discovery>"}

Output: same shape as run_specialist returns.
"""

from __future__ import annotations

import logging

from vendor_concentration_agent.agents import build_investigation_agent
from vendor_concentration_agent.lambda_runtime import run_specialist


logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    question = event.get("question", "")
    discovery_text = event.get("discovery_text", "")
    extra_context = event.get("context", "")

    if discovery_text:
        user_input = f"User question:\n{question}\n\nDiscovery plan:\n{discovery_text}"
    elif extra_context:
        user_input = f"Conversation context:\n{extra_context}\n\nQuestion:\n{question}"
    else:
        user_input = question

    logger.info("Investigation: %s", question[:120])
    return run_specialist(
        "investigation",
        build_investigation_agent,
        user_input,
        "run math on the candidates",
    )
