"""Validator specialist Lambda.

Input:
    {"question": "...", "context": "", "investigation_text": "<findings>"}
"""

from __future__ import annotations

import logging

from vendor_concentration_agent.agents import build_validator_agent
from vendor_concentration_agent.lambda_runtime import run_specialist


logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    question = event.get("question", "")
    investigation_text = event.get("investigation_text", "")
    extra_context = event.get("context", "")

    if investigation_text:
        user_input = f"User question:\n{question}\n\nInvestigation findings:\n{investigation_text}"
    elif extra_context:
        user_input = f"Conversation context:\n{extra_context}\n\nQuestion:\n{question}"
    else:
        user_input = question

    logger.info("Validator: %s", question[:120])
    return run_specialist(
        "validator",
        build_validator_agent,
        user_input,
        "cross-check the findings",
    )
