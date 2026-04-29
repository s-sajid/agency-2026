"""4-agent pipeline — Discovery → Investigation → Validator → Narrative.

Split-brain rendering rule:

  * Internal agents (Discovery, Investigation, Validator) emit their
    output as STRUCTURED JSON which we parse and emit as `tool_result`
    events with kinds `discovery_plan` / `findings` / `verdict`. Their
    text never reaches the chat thread directly.

  * Narrative streams its prose as `text` events — this is the only
    user-visible flowing text in the chat.

  * Math tool calls inside any agent's loop already emit `tool_result`
    events (kind = formula_id) via tools/_wrap.py — those render as
    chips/badges in the chat thread interleaved with the Narrative
    paragraph.
"""

from __future__ import annotations

from vendor_concentration_agent.agents import (
    build_discovery_agent,
    build_investigation_agent,
    build_validator_agent,
    build_narrative_agent,
)
from vendor_concentration_agent.trace.events import EventBus
from vendor_concentration_agent._jsonutil import extract_json
from vendor_concentration_agent.final_brief import build_final_brief


_LABELS = {
    "discovery": "Discovery",
    "investigation": "Investigation",
    "validator": "Validator",
    "narrative": "Narrative",
}

_KIND = {
    "discovery": "discovery_plan",
    "investigation": "findings",
    "validator": "verdict",
}


async def _run_internal_agent(
    bus: EventBus,
    name: str,
    agent_factory,
    user_input: str,
    question_label: str,
) -> tuple[str, dict | None]:
    """Run a non-narrative agent: collect its full output, parse JSON,
    emit as a structured tool_result. Do NOT stream text to the chat.
    Returns (raw_text, parsed_json_or_None).
    """
    await bus.emit_tool_start(name, _LABELS[name], question_label)

    agent = agent_factory()
    collected = ""
    try:
        async for event in agent.stream_async(user_input):
            if isinstance(event, dict) and "data" in event:
                collected += event["data"]
    except Exception as e:
        await bus.emit_error(f"{name} failed: {e}")
        await bus.emit_tool_done(name)
        raise

    parsed = extract_json(collected)
    payload: dict = parsed if parsed is not None else {"raw_text": collected[:500]}
    await bus.emit_tool_result(_KIND[name], payload)
    await bus.emit_tool_done(name)
    return collected, parsed


async def _run_narrative(bus: EventBus, user_input: str) -> str:
    """Narrative outputs JSON like the other agents; we render it as a
    polished `final_brief` card. No flowing prose in the chat.
    """
    await bus.emit_tool_start("narrative", _LABELS["narrative"], "writing the brief")
    agent = build_narrative_agent()
    collected = ""
    try:
        async for event in agent.stream_async(user_input):
            if isinstance(event, dict) and "data" in event:
                collected += event["data"]
    except Exception as e:
        await bus.emit_error(f"narrative failed: {e}")
        await bus.emit_tool_done("narrative")
        raise

    parsed = extract_json(collected)
    payload: dict = parsed if parsed is not None else {"raw_text": collected[:500]}
    await bus.emit_tool_result("final_brief", payload)
    await bus.emit_tool_done("narrative")
    return collected


async def run_full_pipeline(bus: EventBus, question: str) -> str:
    """Discovery → Investigation → Validator → deterministic Final Brief.

    The brief is composed by a pure Python template (no LLM) from the
    structured outputs of the three reasoning agents. This eliminates
    any chance of the Narrative inventing numbers — every field on the
    brief traces back to a real tool call result.
    """
    plan_text, plan = await _run_internal_agent(
        bus, "discovery", build_discovery_agent,
        question, question_label=question[:80],
    )

    findings_text, findings = await _run_internal_agent(
        bus, "investigation", build_investigation_agent,
        f"User question:\n{question}\n\nDiscovery plan:\n{plan_text}",
        question_label="run math on the candidates",
    )

    verdict_text, verdict = await _run_internal_agent(
        bus, "validator", build_validator_agent,
        f"User question:\n{question}\n\nInvestigation findings:\n{findings_text}",
        question_label="cross-check the findings",
    )

    # Deterministic Final Brief — no LLM, no invention. Replaces the
    # Narrative agent for full-pipeline runs.
    brief = build_final_brief(plan or {}, findings or {}, verdict or {})
    await bus.emit_tool_result("final_brief", brief)

    return ""  # the brief itself is the output; no flowing text needed


async def run_single_specialist(
    bus: EventBus,
    name: str,
    question: str,
    context: str = "",
) -> str:
    """Single-specialist routes (discovery / investigation / validation /
    narration). All except narration use the internal-agent path
    (structured card, not text); narration streams text.
    """
    if name == "narrative":
        ui = question if not context else f"Conversation context:\n{context}\n\nQuestion:\n{question}"
        return await _run_narrative(bus, ui)

    factory_map = {
        "discovery": build_discovery_agent,
        "investigation": build_investigation_agent,
        "validator": build_validator_agent,
    }
    if name not in factory_map:
        raise ValueError(f"unknown specialist: {name!r}")

    user_input = question if not context else f"Conversation context:\n{context}\n\nQuestion:\n{question}"
    text, _ = await _run_internal_agent(
        bus, name, factory_map[name], user_input, question_label=question[:80],
    )
    return text
