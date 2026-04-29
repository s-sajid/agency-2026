"""Narrative specialist Lambda — runs in two modes.

  * `narration` (default) — standalone `narration` route. Re-explains a
    prior finding when the user explicitly asks. Free-form prose within
    the existing system prompt's constraints.

  * `paraphrase` — invoked by the orchestrator at the end of the pipeline
    route, between Validator and Final Brief. The agent paraphrases a
    short summary that answers the user's question using ONLY values and
    names that appear in the upstream structured outputs. No new numbers.
    No new vendor names. No new claims. Output: `{"summary": "..."}`.

Input:
    {"mode": "narration" | "paraphrase",
     "question": "...",
     "context": "",
     # paraphrase-only:
     "discovery_parsed": {...},
     "investigation_parsed": {...},
     "validator_parsed": {...}}
"""

from __future__ import annotations

import json
import logging
import textwrap

from vendor_concentration_agent.agents import build_narrative_agent
from vendor_concentration_agent.lambda_runtime import run_specialist


logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _paraphrase_input(
    question: str,
    discovery: dict,
    investigation: dict,
    validator: dict,
) -> str:
    """User-message prompt for paraphrase mode. Locks the output to a
    short summary that answers the user's question using only values
    that appear in the upstream JSON. Replaces the default Final Brief
    output schema for this single invocation.
    """
    return textwrap.dedent(f"""
        You are paraphrasing — NOT analysing. Write 2–3 short sentences that
        answer the user's question using ONLY values, names, and facts that
        appear verbatim in the structured data below.

        STRICT RULES (zero tolerance):
          • Do NOT introduce numbers, percentages, dollar amounts, vendor
            names, ministry names, category names, dates, or fiscal years
            that are not present in the structured data below.
          • Do NOT round, restate, or convert any value (e.g. don't turn an
            HHI of 10000 into "100%", don't shorten "Canada Revenue Agency"
            to "CRA").
          • Do NOT compute or infer new metrics. If a value is not in the
            data, do not state it.
          • Do NOT contradict the Validator verdict. If verdict is
            DIVERGE, INSUFFICIENT_DATA, or PARTIAL, your summary must
            reflect that hedge.
          • If the data does not support an answer to the user's question,
            say so plainly in one sentence.

        Output a JSON object and nothing else:
            {{"summary": "<2–3 sentences>"}}

        ── User question ──
        {question}

        ── Discovery (structured) ──
        {json.dumps(discovery, indent=2, ensure_ascii=False)}

        ── Investigation (structured) ──
        {json.dumps(investigation, indent=2, ensure_ascii=False)}

        ── Validator (structured) ──
        {json.dumps(validator, indent=2, ensure_ascii=False)}
    """).strip()


def handler(event, context):
    mode = event.get("mode", "narration")
    question = event.get("question", "")

    if mode == "paraphrase":
        user_input = _paraphrase_input(
            question,
            event.get("discovery_parsed") or {},
            event.get("investigation_parsed") or {},
            event.get("validator_parsed") or {},
        )
        logger.info("Narrative paraphrase: %s", question[:120])
        result = run_specialist(
            "narrative", build_narrative_agent, user_input, "paraphrasing findings"
        )
        # The generic runner emits a `tool_result` with kind="final_brief"
        # (the Narrative agent's default card slot). In paraphrase mode that
        # would render as a second, malformed Final Brief card alongside
        # the orchestrator's real one. Strip it — the orchestrator will
        # emit a plain text event with the paraphrase below the Final
        # Brief card so the prose reads as flowing chat copy, not a card.
        result["events"] = [
            e for e in result.get("events", [])
            if not (
                e.get("kind") == "tool_result"
                and (e.get("payload") or {}).get("kind") == "final_brief"
            )
        ]
        return result

    # Default: standalone narration route
    extra_context = event.get("context", "")
    user_input = question if not extra_context else f"Conversation context:\n{extra_context}\n\nQuestion:\n{question}"
    logger.info("Narrative: %s", question[:120])
    return run_specialist("narrative", build_narrative_agent, user_input, "writing the brief")
