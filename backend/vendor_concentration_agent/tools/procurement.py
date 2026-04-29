"""Strands @tool wrappers for the procurement math functions."""

from __future__ import annotations

from typing import Any

from strands import tool

from vendor_concentration_agent.math import (
    sole_source_rate,
    incumbency_streak,
    vendor_footprint,
    competition_count,
)
from vendor_concentration_agent.tools._wrap import new_call_id, summarize_for_llm


@tool
def sole_source_share(
    ministry: str | None = None,
    fiscal_year: str | None = None,
) -> dict[str, Any]:
    """Share of Alberta procurement dollars awarded WITHOUT competitive bid,
    optionally narrowed to a single ministry and/or fiscal year. Computed
    as sole_source_$ / (sole_source_$ + competitive_$) × 100.

    Args:
        ministry: optional ministry filter (exact text from the source tables).
        fiscal_year: optional fiscal year string, e.g. "2024 - 2025".
    """
    result = sole_source_rate(ministry=ministry, fiscal_year=fiscal_year)
    return summarize_for_llm(result, new_call_id("sole_source_rate"))


@tool
def how_long_has_vendor_held_category(
    dataset: str,
    vendor: str,
    category: str,
) -> dict[str, Any]:
    """Longest run of consecutive fiscal years where the named vendor has
    held contracts in the named category — the incumbency streak. A long
    streak signals incumbency advantage that's hard for newcomers to
    displace.

    Args:
        dataset: "ab_sole_source".
        vendor: exact vendor text.
        category: exact category text.
    """
    result = incumbency_streak(dataset=dataset, vendor=vendor, category=category)
    return summarize_for_llm(result, new_call_id("incumbency"))


@tool
def vendor_full_footprint(vendor: str) -> dict[str, Any]:
    """How widely a vendor reaches across Alberta procurement: distinct
    ministries served, distinct categories won, total $ awarded, contract
    count, and the year range of activity. Pulls from both ab.ab_sole_source
    and ab.ab_contracts.

    Note: this matches by exact vendor name. Spelling variants may be
    counted separately. The Validator should call cross_dataset_lookup_for_vendor
    if a finding hinges on the footprint number.

    Args:
        vendor: exact vendor name.
    """
    result = vendor_footprint(vendor=vendor)
    return summarize_for_llm(result, new_call_id("footprint"))


@tool
def how_many_distinct_vendors_in_category(dataset: str, category: str) -> dict[str, Any]:
    """How many distinct vendors have ever appeared in this category. A
    small number — even when total spend is large — suggests a thin
    supplier base and a capacity-gap risk (Integrity sub-theme).

    Args:
        dataset: "ab_sole_source".
        category: exact category text.
    """
    result = competition_count(dataset=dataset, category=category)
    return summarize_for_llm(result, new_call_id("competition"))
