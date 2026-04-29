"""Formula explainer registry — drives the ⓘ popover next to every number
in the UI.

Single source of truth: every math function returns `formula_id`; the UI
looks the id up here to render the popover (plain English + formula text +
DOJ-style interpretation bands + reference URL + live computation trace).

When `reference_id` is None, the popover renders the formula as its own
authority — appropriate for pure ratios and counts. When it has a value,
the id MUST resolve in `references/references.json` or the Validator's
formula-explainability gate fails.
"""

from __future__ import annotations

from typing import TypedDict


class Band(TypedDict):
    label: str
    range: str
    severity: str  # 'low' | 'moderate' | 'high'


class Explainer(TypedDict):
    name: str
    plain_english: str
    formula_text: str
    interpretation_bands: list[Band]
    reference_id: str | None
    compute_trace_template: str | None


EXPLAINERS: dict[str, Explainer] = {
    # -- Concentration ----------------------------------------------------
    "hhi": {
        "name": "Herfindahl-Hirschman Index",
        "plain_english": (
            "A measure of how concentrated a market is. Add up each "
            "vendor's market share squared. The bigger the number, the more "
            "concentrated."
        ),
        "formula_text": "HHI = Σ (sᵢ)²    where sᵢ is vendor i's share, 0–100",
        "interpretation_bands": [
            {"label": "Competitive",          "range": "< 1,500",        "severity": "low"},
            {"label": "Moderately concentrated", "range": "1,500 – 2,500", "severity": "moderate"},
            {"label": "Highly concentrated",  "range": "> 2,500",        "severity": "high"},
        ],
        "reference_id": "doj_hhi",
        "compute_trace_template": "{vendor}: {share_pct}% squared = {share_pct_squared}",
    },
    "cr_n": {
        "name": "Concentration Ratio (CR_n)",
        "plain_english": (
            "The combined market share of the top n vendors. CR_1 is the "
            "largest single vendor's share. CR_4 is the four-firm "
            "concentration ratio used in industrial-organization economics."
        ),
        "formula_text": "CR_n = Σᵢ₌₁ⁿ sᵢ    (top n vendors, share 0–100)",
        "interpretation_bands": [
            {"label": "Competitive (CR_4)",  "range": "< 40%",   "severity": "low"},
            {"label": "Moderate (CR_4)",     "range": "40 – 70%", "severity": "moderate"},
            {"label": "Tight oligopoly (CR_4)", "range": "> 70%", "severity": "high"},
        ],
        "reference_id": None,  # pure ratio; the formula is its own authority
        "compute_trace_template": "rank {rank} · {vendor}: {share_pct}% (vendor_amt={vendor_amt})",
    },
    "gini": {
        "name": "Gini Coefficient",
        "plain_english": (
            "How unequal the distribution of contract value is across "
            "vendors. 0 means every vendor wins exactly the same dollar "
            "amount; closer to 1 means one vendor takes everything and "
            "the rest get crumbs."
        ),
        "formula_text": "G = ( 2·Σ i·xᵢ ) / ( n·Σ xᵢ )  −  (n+1)/n    (xᵢ sorted ascending)",
        "interpretation_bands": [
            {"label": "Equal distribution",   "range": "< 0.30", "severity": "low"},
            {"label": "Moderate inequality",  "range": "0.30 – 0.60", "severity": "moderate"},
            {"label": "Highly unequal",       "range": "> 0.60", "severity": "high"},
        ],
        "reference_id": "worldbank_gini",
        "compute_trace_template": "rank_asc {rank_asc}: vendor_amt={vendor_amt} → i·amt={i_times_amt}",
    },

    # -- Procurement ------------------------------------------------------
    "sole_source_rate": {
        "name": "Sole-Source Rate",
        "plain_english": (
            "What share of procurement dollars in a given scope was "
            "awarded without competitive bidding. A high share means "
            "competitive procurement is the exception, not the rule."
        ),
        "formula_text": "rate = ($ sole-source) / ($ sole-source + $ competitive) × 100",
        "interpretation_bands": [
            {"label": "Mostly competitive",   "range": "< 10%",  "severity": "low"},
            {"label": "Mixed",                "range": "10 – 30%", "severity": "moderate"},
            {"label": "Sole-source dominant", "range": "> 30%",  "severity": "high"},
        ],
        "reference_id": None,
        "compute_trace_template": "{step} = {value}",
    },
    "incumbency_streak": {
        "name": "Incumbency Streak",
        "plain_english": (
            "The longest run of consecutive fiscal years where the same "
            "vendor received contracts in this category. A long streak "
            "signals incumbency advantage that's hard for newcomers to "
            "displace."
        ),
        "formula_text": "max consecutive fiscal years where vendor ∈ winners(category)",
        "interpretation_bands": [
            {"label": "Short tenure",    "range": "1 – 2 years", "severity": "low"},
            {"label": "Established",     "range": "3 – 5 years", "severity": "moderate"},
            {"label": "Entrenched",      "range": "> 5 years",   "severity": "high"},
        ],
        "reference_id": None,
        "compute_trace_template": "{step}: {value}",
    },
    "vendor_footprint": {
        "name": "Vendor Footprint",
        "plain_english": (
            "How widely a vendor reaches across the provincial procurement "
            "landscape — distinct ministries served, distinct categories "
            "won, total dollars, and the year range over which they've "
            "been awarded contracts."
        ),
        "formula_text": "footprint = (distinct ministries, distinct categories, total $, contract count, year range)",
        "interpretation_bands": [],
        "reference_id": None,
        "compute_trace_template": "{step}: {value}",
    },
    "competition_count": {
        "name": "Competition Count",
        "plain_english": (
            "How many distinct vendors have ever appeared in this category. "
            "A small number — even when total spend is large — suggests a "
            "thin supplier base and a capacity-gap risk."
        ),
        "formula_text": "n_vendors = COUNT(DISTINCT vendor) WHERE category = X AND amount > 0",
        "interpretation_bands": [
            {"label": "Very thin",       "range": "1 – 2 vendors",  "severity": "high"},
            {"label": "Limited",         "range": "3 – 9 vendors",  "severity": "moderate"},
            {"label": "Healthy market",  "range": "≥ 10 vendors",   "severity": "low"},
        ],
        "reference_id": None,
        "compute_trace_template": "{step} = {value}",
    },

    # -- Cross-check ------------------------------------------------------
    "cross_dataset_lookup": {
        "name": "Cross-Dataset Lookup",
        "plain_english": (
            "Resolves a vendor name through the organizers' entity-matching "
            "layer (general.entity_golden_records) to find the same legal "
            "entity across CRA charity filings, federal grants, and Alberta "
            "procurement. Used to confirm a lock-in finding isn't a "
            "provincial quirk."
        ),
        "formula_text": "lookup = entity_golden_records WHERE canonical_name ILIKE %vendor%",
        "interpretation_bands": [],
        "reference_id": None,
        "compute_trace_template": "{step}: {value}",
    },
    "divergence_check": {
        "name": "Divergence Check",
        "plain_english": (
            "Compares two computations of the same quantity. If the values "
            "agree within 1% the verdict is MATCH; 1–10% is PARTIAL; over "
            "10% is DIVERGE — meaning the original finding may be an "
            "artifact and should be re-investigated."
        ),
        "formula_text": "delta_pct = |a − b| / max(|a|, |b|) × 100",
        "interpretation_bands": [
            {"label": "MATCH",   "range": "< 1%",      "severity": "low"},
            {"label": "PARTIAL", "range": "1 – 10%",   "severity": "moderate"},
            {"label": "DIVERGE", "range": "> 10%",     "severity": "high"},
        ],
        "reference_id": None,
        "compute_trace_template": "{step}: {value}",
    },

    # -- Discovery helper -------------------------------------------------
    "top_concentrated_categories": {
        "name": "Top-Concentrated Categories (watchlist)",
        "plain_english": (
            "Ranks every category in a dataset by single-vendor share, "
            "filtered to those above a minimum cumulative spend. Used by "
            "the Discovery agent to pick the most-concentrated candidates "
            "for deeper investigation."
        ),
        "formula_text": "rank by CR_1 desc, cat_total desc WHERE cat_total ≥ min_total",
        "interpretation_bands": [],
        "reference_id": None,
        "compute_trace_template": None,
    },
}


def get(formula_id: str) -> Explainer:
    if formula_id not in EXPLAINERS:
        raise KeyError(f"unknown formula_id: {formula_id!r}. Known: {sorted(EXPLAINERS)}")
    return EXPLAINERS[formula_id]
