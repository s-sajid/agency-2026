"""Market concentration formulas — HHI, CR_n, Gini, plus a discovery
helper that ranks every category in a dataset by single-vendor share.

All values are computed in SQL on the source-of-truth Postgres tables.
Each function returns a MathResult with the SQL, source rows, per-term
arithmetic trace, and references to the published methodology.
"""

from __future__ import annotations

from vendor_concentration_agent.data.postgres import query
from vendor_concentration_agent.data.datasets import get as _get_dataset
from vendor_concentration_agent.math.types import MathResult


# ---------------------------------------------------------------------------
# Internal: load per-vendor amounts for a category (used by HHI, CR_n, Gini)
# ---------------------------------------------------------------------------

def _vendor_amounts(dataset: str, category: str) -> tuple[str, list[dict]]:
    ds = _get_dataset(dataset)
    if ds.category_col is None:
        raise ValueError(f"dataset {dataset!r} has no category column")
    sql = f"""
        SELECT {ds.vendor_col} AS vendor,
               SUM({ds.amount_col})::numeric AS vendor_amt
        FROM {ds.table}
        WHERE {ds.category_col} = %(cat)s
          AND {ds.amount_col} IS NOT NULL
          AND {ds.amount_col} > 0
        GROUP BY {ds.vendor_col}
        ORDER BY vendor_amt DESC
    """
    rows = query(sql, {"cat": category})
    return sql.strip(), rows


# ---------------------------------------------------------------------------
# HHI — Herfindahl-Hirschman Index
# ---------------------------------------------------------------------------

def hhi_by_category(dataset: str, category: str) -> MathResult:
    """HHI = Σ (sᵢ)²  where sᵢ is vendor i's market share as a percentage 0–100.
    Range 0–10,000. DOJ/FTC bands: <1500 competitive · 1500–2500 moderate ·
    >2500 highly concentrated.
    """
    sql, rows = _vendor_amounts(dataset, category)
    total = sum(float(r["vendor_amt"]) for r in rows)

    trace_steps: list[dict] = []
    hhi = 0.0
    for r in rows:
        share_pct = 100.0 * float(r["vendor_amt"]) / total if total else 0.0
        squared = share_pct ** 2
        hhi += squared
        trace_steps.append({
            "vendor": r["vendor"],
            "vendor_amt": float(r["vendor_amt"]),
            "share_pct": round(share_pct, 4),
            "share_pct_squared": round(squared, 4),
        })

    return MathResult(
        value=round(hhi, 2),
        formula_id="hhi",
        sql=sql,
        source_rows=[{"vendor": r["vendor"], "vendor_amt": float(r["vendor_amt"])} for r in rows],
        trace_steps=trace_steps,
        references=["doj_hhi"],
        inputs={"dataset": dataset, "category": category, "category_total": total, "vendor_count": len(rows)},
    )


# ---------------------------------------------------------------------------
# CR_n — Concentration ratio (top-n combined share)
# ---------------------------------------------------------------------------

def cr_n_by_category(dataset: str, category: str, n: int = 4) -> MathResult:
    """Combined market share of the top n vendors in a category, 0–100.
    CR_1 = single-vendor share; CR_4 = standard industrial-org concentration ratio.
    """
    if n < 1:
        raise ValueError("n must be >= 1")

    sql, rows = _vendor_amounts(dataset, category)
    total = sum(float(r["vendor_amt"]) for r in rows)
    top = rows[:n]
    top_total = sum(float(r["vendor_amt"]) for r in top)
    cr = 100.0 * top_total / total if total else 0.0

    trace_steps = [
        {
            "rank": i + 1,
            "vendor": r["vendor"],
            "vendor_amt": float(r["vendor_amt"]),
            "share_pct": round(100.0 * float(r["vendor_amt"]) / total, 4) if total else 0.0,
        }
        for i, r in enumerate(top)
    ]

    return MathResult(
        value=round(cr, 4),
        formula_id="cr_n",
        sql=sql,
        source_rows=[{"vendor": r["vendor"], "vendor_amt": float(r["vendor_amt"])} for r in rows],
        trace_steps=trace_steps,
        references=[],
        inputs={"dataset": dataset, "category": category, "n": n, "category_total": total, "vendor_count": len(rows)},
    )


# ---------------------------------------------------------------------------
# Gini — coefficient of inequality across vendor amounts in a category
# ---------------------------------------------------------------------------

def gini_by_category(dataset: str, category: str) -> MathResult:
    """Gini coefficient of contract-value distribution across vendors in a
    category. 0 = perfect equality (all vendors win equal $); ~1 = one vendor
    takes everything.

    Implementation uses the sorted-array form:
        G = ( 2·Σ(i·xᵢ) ) / ( n·Σxᵢ )  −  (n + 1) / n
    where xᵢ are vendor amounts sorted ascending and i is 1-indexed.

    Reference: Statistics Canada Gini methodology.
    """
    sql, rows = _vendor_amounts(dataset, category)
    amounts = sorted(float(r["vendor_amt"]) for r in rows)
    n = len(amounts)
    total = sum(amounts)
    if n == 0 or total == 0:
        gini = 0.0
        trace_steps: list[dict] = []
    else:
        weighted = sum((i + 1) * x for i, x in enumerate(amounts))
        gini = (2.0 * weighted) / (n * total) - (n + 1) / n
        trace_steps = [
            {"rank_asc": i + 1, "vendor_amt": x, "i_times_amt": (i + 1) * x}
            for i, x in enumerate(amounts)
        ]

    return MathResult(
        value=round(gini, 6),
        formula_id="gini",
        sql=sql,
        source_rows=[{"vendor": r["vendor"], "vendor_amt": float(r["vendor_amt"])} for r in rows],
        trace_steps=trace_steps,
        references=["worldbank_gini"],
        inputs={
            "dataset": dataset,
            "category": category,
            "n_vendors": n,
            "category_total": total,
            "weighted_sum": sum((i + 1) * x for i, x in enumerate(amounts)) if n else 0,
        },
    )


# ---------------------------------------------------------------------------
# Discovery helper — top-concentrated categories ranked by CR_1
# ---------------------------------------------------------------------------

def top_concentrated_categories(
    dataset: str,
    min_total: float = 10_000_000,
    limit: int = 20,
) -> MathResult:
    """Rank categories by single-vendor share, filtered to those with
    cumulative spend ≥ min_total. Used by the Discovery agent to pick which
    categories deserve a deep look.
    """
    ds = _get_dataset(dataset)
    if ds.category_col is None:
        raise ValueError(f"dataset {dataset!r} has no category column")

    sql = f"""
        WITH cat AS (
          SELECT {ds.category_col} AS category,
                 {ds.vendor_col} AS vendor,
                 SUM({ds.amount_col}) AS vendor_amt
          FROM {ds.table}
          WHERE {ds.category_col} IS NOT NULL
            AND {ds.amount_col} IS NOT NULL
            AND {ds.amount_col} > 0
          GROUP BY {ds.category_col}, {ds.vendor_col}
        ),
        totals AS (
          SELECT category,
                 SUM(vendor_amt) AS cat_total,
                 COUNT(DISTINCT vendor) AS vendor_count
          FROM cat
          GROUP BY category
        ),
        ranked AS (
          SELECT cat.category, cat.vendor, cat.vendor_amt,
                 totals.cat_total, totals.vendor_count,
                 ROW_NUMBER() OVER (
                   PARTITION BY cat.category ORDER BY cat.vendor_amt DESC
                 ) AS rk
          FROM cat
          JOIN totals USING (category)
          WHERE totals.cat_total >= %(min_total)s
        )
        SELECT category,
               vendor AS top_vendor,
               cat_total::numeric AS cat_total,
               vendor_count,
               (100.0 * vendor_amt / cat_total)::numeric AS top1_share_pct
        FROM ranked
        WHERE rk = 1
        ORDER BY top1_share_pct DESC, cat_total DESC
        LIMIT %(limit)s
    """
    rows = query(sql, {"min_total": min_total, "limit": limit})

    return MathResult(
        value=[
            {
                "category": r["category"],
                "top_vendor": r["top_vendor"],
                "cat_total": float(r["cat_total"]),
                "vendor_count": int(r["vendor_count"]),
                "top1_share_pct": round(float(r["top1_share_pct"]), 2),
            }
            for r in rows
        ],
        formula_id="top_concentrated_categories",
        sql=sql.strip(),
        source_rows=[{k: (float(v) if str(type(v).__name__) == "Decimal" else v) for k, v in r.items()} for r in rows],
        trace_steps=[],
        references=[],
        inputs={"dataset": dataset, "min_total": min_total, "limit": limit},
    )
