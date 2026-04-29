"""Cross-dataset lookup + divergence check — the Validator's two main tools."""

from __future__ import annotations

from vendor_concentration_agent.data.postgres import query
from vendor_concentration_agent.math.types import MathResult


# ---------------------------------------------------------------------------
# Cross-dataset lookup — does this vendor appear in other jurisdictions?
# ---------------------------------------------------------------------------

def cross_dataset_lookup(vendor_name: str) -> MathResult:
    """Resolve a vendor name through `general.entity_golden_records` and pull
    a one-row summary of its presence in CRA / FED / AB. The Validator uses
    this to confirm that a "lock-in" finding is not just a provincial quirk.

    Match strategy: case-insensitive ILIKE on `canonical_name` and
    `norm_name`. Returns the top match by source-link count.
    """
    sql = """
        SELECT id, canonical_name, entity_type,
               dataset_sources, source_link_count,
               (cra_profile IS NOT NULL) AS has_cra,
               (fed_profile IS NOT NULL) AS has_fed,
               (ab_profile  IS NOT NULL) AS has_ab,
               cra_profile, fed_profile, ab_profile
        FROM general.entity_golden_records
        WHERE canonical_name ILIKE %(p)s
           OR norm_name      ILIKE %(p)s
        ORDER BY source_link_count DESC NULLS LAST
        LIMIT 1
    """
    pattern = f"%{vendor_name}%"
    rows = query(sql, {"p": pattern})

    if not rows:
        return MathResult(
            value={"matched": False, "vendor_name_searched": vendor_name},
            formula_id="cross_dataset_lookup",
            sql=sql.strip(),
            source_rows=[],
            trace_steps=[{"step": "match", "value": "no entity_golden_records hit"}],
            references=[],
            inputs={"vendor_name": vendor_name},
        )

    r = rows[0]
    sources = list(r.get("dataset_sources") or [])

    return MathResult(
        value={
            "matched": True,
            "canonical_name": r["canonical_name"],
            "entity_type": r["entity_type"],
            "dataset_sources": sources,
            "source_link_count": int(r.get("source_link_count") or 0),
            "appears_in_cra": bool(r.get("has_cra")),
            "appears_in_fed": bool(r.get("has_fed")),
            "appears_in_ab": bool(r.get("has_ab")),
        },
        formula_id="cross_dataset_lookup",
        sql=sql.strip(),
        source_rows=[{
            "id": r["id"],
            "canonical_name": r["canonical_name"],
            "dataset_sources": sources,
            "source_link_count": r.get("source_link_count"),
        }],
        trace_steps=[
            {"step": "search_pattern", "value": pattern},
            {"step": "matched_canonical_name", "value": r["canonical_name"]},
            {"step": "dataset_sources", "value": sources},
        ],
        references=[],
        inputs={"vendor_name": vendor_name},
    )


# ---------------------------------------------------------------------------
# Divergence check — pure arithmetic comparison of two computed values
# ---------------------------------------------------------------------------

def divergence_check(value_a: float, value_b: float) -> MathResult:
    """Compare two computations of the same quantity. Produces a verdict:

      MATCH    if relative diff < 1%
      PARTIAL  if relative diff in [1%, 10%]
      DIVERGE  if relative diff > 10%

    Used by the Validator to confirm a finding survives a second computation
    via a sibling table or a finer-grained SQL slice.
    """
    delta_abs = abs(value_a - value_b)
    base = max(abs(value_a), abs(value_b))
    delta_pct = (100.0 * delta_abs / base) if base else 0.0

    if delta_pct < 1.0:
        verdict = "MATCH"
    elif delta_pct <= 10.0:
        verdict = "PARTIAL"
    else:
        verdict = "DIVERGE"

    return MathResult(
        value={
            "verdict": verdict,
            "value_a": value_a,
            "value_b": value_b,
            "delta_abs": delta_abs,
            "delta_pct": round(delta_pct, 4),
        },
        formula_id="divergence_check",
        sql="",  # pure arithmetic, no SQL
        source_rows=[],
        trace_steps=[
            {"step": "value_a", "value": value_a},
            {"step": "value_b", "value": value_b},
            {"step": "delta_abs", "value": delta_abs},
            {"step": "delta_pct", "value": round(delta_pct, 4)},
            {"step": "verdict", "value": verdict},
        ],
        references=[],
        inputs={"value_a": value_a, "value_b": value_b},
    )
