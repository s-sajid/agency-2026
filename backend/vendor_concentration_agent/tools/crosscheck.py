"""Strands @tool wrappers for the Validator's cross-check tools."""

from __future__ import annotations

from typing import Any

from strands import tool

from vendor_concentration_agent.math import cross_dataset_lookup, divergence_check
from vendor_concentration_agent.tools._wrap import new_call_id, summarize_for_llm


@tool
def cross_dataset_lookup_for_vendor(vendor_name: str) -> dict[str, Any]:
    """Resolve a vendor through the organizers' entity-matching layer
    (general.entity_golden_records) and report which datasets the same legal
    entity appears in (CRA charity filings, federal grants, Alberta
    procurement). Use this to confirm a finding isn't a provincial quirk.

    Args:
        vendor_name: a vendor name as it appears in the source tables.
            Case-insensitive ILIKE; partial matches are accepted.
    """
    result = cross_dataset_lookup(vendor_name=vendor_name)
    return summarize_for_llm(result, new_call_id("crosscheck"))


@tool
def compare_two_computations(
    value_a: float,
    value_b: float,
    label_a: str = "A",
    label_b: str = "B",
) -> dict[str, Any]:
    """Compare two computed values of the same quantity. Returns a verdict:
    MATCH (< 1% diff), PARTIAL (1–10%), DIVERGE (> 10%). Use this to confirm
    a finding survives a second computation via a sibling table or finer SQL.

    Args:
        value_a: first computed value (e.g. from primary table).
        value_b: second computed value (e.g. from sibling table).
        label_a: human label for value_a (for the trace).
        label_b: human label for value_b (for the trace).
    """
    result = divergence_check(value_a=value_a, value_b=value_b)
    summary = summarize_for_llm(result, new_call_id("divergence"))
    summary["labels"] = {"a": label_a, "b": label_b}
    return summary
