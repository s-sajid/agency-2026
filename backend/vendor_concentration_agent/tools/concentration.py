"""Strands @tool wrappers for the concentration math functions.

Each tool is a thin adapter: take simple LLM-friendly args, call the
deterministic math, push full audit data to the EventBus, return a lean
summary the LLM can reason about.
"""

from __future__ import annotations

from typing import Any

from strands import tool

from vendor_concentration_agent.math import (
    hhi_by_category,
    cr_n_by_category,
    gini_by_category,
    top_concentrated_categories,
)
from vendor_concentration_agent.tools._wrap import new_call_id, summarize_for_llm


@tool
def list_top_concentrated_categories(
    dataset: str = "ab_sole_source",
    min_total: float = 10_000_000.0,
    limit: int = 10,
) -> dict[str, Any]:
    """List categories ranked by single-vendor share, filtered to those with
    cumulative spend at or above min_total.

    Use this at Discovery time to pick which category deserves a deep look.
    Returns a ranked list with each entry's top vendor, vendor count,
    cumulative spend, and CR_1 share (top-1 vendor's percentage).

    Args:
        dataset: which procurement dataset to scan. Allowed: "ab_sole_source".
        min_total: drop categories whose total spend is below this threshold.
        limit: max number of categories to return.
    """
    result = top_concentrated_categories(dataset=dataset, min_total=min_total, limit=limit)
    return summarize_for_llm(result, new_call_id("top_categories"))


@tool
def hhi_for_category(dataset: str, category: str) -> dict[str, Any]:
    """Compute the Herfindahl-Hirschman Index (HHI) for a specific category
    in a specific dataset.

    HHI is the sum of (vendor_share_percent)^2. Range 0–10,000. DOJ/FTC bands:
    below 1500 = competitive, 1500–2500 = moderately concentrated, above
    2500 = highly concentrated. A category with a single vendor returns
    HHI = 10,000.

    Args:
        dataset: "ab_sole_source".
        category: exact category text from the procurement table.
    """
    result = hhi_by_category(dataset=dataset, category=category)
    return summarize_for_llm(result, new_call_id("hhi"))


@tool
def cr_n_for_category(dataset: str, category: str, n: int = 4) -> dict[str, Any]:
    """Compute the top-n concentration ratio (CR_n) for a category. CR_1 is
    the single largest vendor's share; CR_4 is the four-firm concentration
    ratio used in industrial-organization economics.

    Args:
        dataset: "ab_sole_source".
        category: exact category text.
        n: how many top vendors to combine. Default 4.
    """
    result = cr_n_by_category(dataset=dataset, category=category, n=n)
    return summarize_for_llm(result, new_call_id(f"cr{n}"))


@tool
def gini_for_category(dataset: str, category: str) -> dict[str, Any]:
    """Compute the Gini coefficient of contract-value distribution across
    vendors in a category. 0 = perfect equality (all vendors win equal $);
    closer to 1 = one vendor takes everything.

    Args:
        dataset: "ab_sole_source".
        category: exact category text.
    """
    result = gini_by_category(dataset=dataset, category=category)
    return summarize_for_llm(result, new_call_id("gini"))
