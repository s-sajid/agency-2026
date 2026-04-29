"""Procurement-specific metrics — sole-source share, incumbency, vendor
footprint, competition count.
"""

from __future__ import annotations

from vendor_concentration_agent.data.postgres import query
from vendor_concentration_agent.data.datasets import get as _get_dataset
from vendor_concentration_agent.math.types import MathResult


# ---------------------------------------------------------------------------
# Sole-source rate — share of procurement dollars not subject to competition
# ---------------------------------------------------------------------------

def sole_source_rate(
    ministry: str | None = None,
    fiscal_year: str | None = None,
) -> MathResult:
    """Sole-source rate = $ sole-source / ($ sole-source + $ contracts), 0–100.

    Computed by summing both Alberta procurement tables under the same scope
    filters. A simple ratio — no external citation. The interpretation we
    attach: a high sole-source share signals that competitive procurement
    is the exception rather than the rule for that scope.
    """
    where: list[str] = ["amount IS NOT NULL", "amount > 0"]
    params: dict = {}
    if ministry is not None:
        where.append("ministry = %(ministry)s")
        params["ministry"] = ministry
    if fiscal_year is not None:
        where.append("display_fiscal_year = %(fy)s")
        params["fy"] = fiscal_year
    where_sql = " AND ".join(where)

    sql = f"""
        SELECT 'sole_source' AS source, COALESCE(SUM(amount), 0)::numeric AS total
        FROM ab.ab_sole_source
        WHERE {where_sql}
        UNION ALL
        SELECT 'contracts' AS source, COALESCE(SUM(amount), 0)::numeric AS total
        FROM ab.ab_contracts
        WHERE {where_sql}
    """
    rows = query(sql, params)
    by_source = {r["source"]: float(r["total"]) for r in rows}
    sole = by_source.get("sole_source", 0.0)
    comp = by_source.get("contracts", 0.0)
    total = sole + comp
    rate = 100.0 * sole / total if total else 0.0

    return MathResult(
        value=round(rate, 4),
        formula_id="sole_source_rate",
        sql=sql.strip(),
        source_rows=[{"source": k, "total": v} for k, v in by_source.items()],
        trace_steps=[
            {"step": "sole_source_total", "value": sole},
            {"step": "contracts_total", "value": comp},
            {"step": "denominator (sum)", "value": total},
            {"step": "numerator / denominator * 100", "value": round(rate, 4)},
        ],
        references=[],
        inputs={"ministry": ministry, "fiscal_year": fiscal_year},
    )


# ---------------------------------------------------------------------------
# Incumbency streak — max consecutive fiscal years a vendor appears in a category
# ---------------------------------------------------------------------------

def incumbency_streak(dataset: str, vendor: str, category: str) -> MathResult:
    """Longest run of consecutive fiscal years where the named vendor
    received at least one contract in the named category. Pure count of
    consecutive year ticks — no external citation.
    """
    ds = _get_dataset(dataset)
    if ds.category_col is None or ds.fiscal_year_col is None:
        raise ValueError(f"dataset {dataset!r} lacks category or fiscal_year column")

    sql = f"""
        SELECT DISTINCT {ds.fiscal_year_col} AS fy
        FROM {ds.table}
        WHERE {ds.vendor_col} = %(vendor)s
          AND {ds.category_col} = %(cat)s
          AND {ds.amount_col} IS NOT NULL
          AND {ds.amount_col} > 0
          AND {ds.fiscal_year_col} IS NOT NULL
        ORDER BY fy
    """
    rows = query(sql, {"vendor": vendor, "cat": category})
    years = [r["fy"] for r in rows]

    # Convert each fiscal year to its first 4-digit number so we can detect
    # consecutive runs ("2019-2020" → 2019, "2024" → 2024).
    def _to_int(s: str) -> int | None:
        digits = ""
        for ch in s:
            if ch.isdigit():
                digits += ch
                if len(digits) == 4:
                    break
            elif digits:
                break
        return int(digits) if len(digits) == 4 else None

    parsed: list[tuple[str, int]] = [(y, _to_int(y)) for y in years if _to_int(y) is not None]
    parsed.sort(key=lambda t: t[1])

    longest_run: list[str] = []
    current_run: list[str] = []
    last_year: int | None = None
    for y_str, y_int in parsed:
        if last_year is None or y_int == last_year + 1:
            current_run.append(y_str)
        else:
            if len(current_run) > len(longest_run):
                longest_run = current_run
            current_run = [y_str]
        last_year = y_int
    if len(current_run) > len(longest_run):
        longest_run = current_run

    return MathResult(
        value=len(longest_run),
        formula_id="incumbency_streak",
        sql=sql.strip(),
        source_rows=[{"fy": y} for y in years],
        trace_steps=[
            {"step": "all_years_with_contracts", "value": years},
            {"step": "longest_consecutive_run", "value": longest_run},
            {"step": "streak_length", "value": len(longest_run)},
        ],
        references=[],
        inputs={"dataset": dataset, "vendor": vendor, "category": category},
    )


# ---------------------------------------------------------------------------
# Vendor footprint — distinct (ministry, category) coverage for a vendor
# ---------------------------------------------------------------------------

def vendor_footprint(vendor: str) -> MathResult:
    """How widely does a vendor reach across Alberta procurement?
    Returns ministries + categories + total $ + contract count, joined across
    ab.ab_sole_source and ab.ab_contracts. Pure aggregation; no citation.
    """
    sql = """
        WITH ss AS (
          SELECT vendor AS vendor, ministry, contract_services AS category,
                 amount, display_fiscal_year, 'sole_source' AS source
          FROM ab.ab_sole_source
          WHERE vendor = %(vendor)s AND amount > 0
        ),
        ct AS (
          SELECT recipient AS vendor, ministry, NULL::text AS category,
                 amount, display_fiscal_year, 'contracts' AS source
          FROM ab.ab_contracts
          WHERE recipient = %(vendor)s AND amount > 0
        ),
        all_rows AS (
          SELECT * FROM ss UNION ALL SELECT * FROM ct
        )
        SELECT
          COUNT(*)                                  AS contract_count,
          SUM(amount)::numeric                      AS total_amount,
          COUNT(DISTINCT ministry)                  AS ministry_count,
          COUNT(DISTINCT category)
            FILTER (WHERE category IS NOT NULL)     AS category_count,
          MIN(display_fiscal_year)                  AS first_year,
          MAX(display_fiscal_year)                  AS last_year,
          ARRAY_AGG(DISTINCT ministry ORDER BY ministry) AS ministries
        FROM all_rows
    """
    rows = query(sql, {"vendor": vendor})
    r = rows[0] if rows else {}
    contract_count = int(r.get("contract_count") or 0)
    total = float(r.get("total_amount") or 0)
    ministries = list(r.get("ministries") or [])

    return MathResult(
        value={
            "contract_count": contract_count,
            "total_amount": total,
            "ministry_count": int(r.get("ministry_count") or 0),
            "category_count": int(r.get("category_count") or 0),
            "first_year": r.get("first_year"),
            "last_year": r.get("last_year"),
            "ministries": ministries,
        },
        formula_id="vendor_footprint",
        sql=sql.strip(),
        source_rows=[r] if r else [],
        trace_steps=[
            {"step": "ministries_touched", "value": ministries},
            {"step": "contract_count", "value": contract_count},
            {"step": "total_amount", "value": total},
        ],
        references=[],
        inputs={"vendor": vendor},
    )


# ---------------------------------------------------------------------------
# Competition count — distinct vendors who ever appeared in a category
# ---------------------------------------------------------------------------

def competition_count(dataset: str, category: str) -> MathResult:
    """How many distinct vendors have ever appeared in this category?
    A low number is a capacity-gap signal (Integrity sub-theme). Pure count.
    """
    ds = _get_dataset(dataset)
    if ds.category_col is None:
        raise ValueError(f"dataset {dataset!r} has no category column")

    sql = f"""
        SELECT COUNT(DISTINCT {ds.vendor_col}) AS n_vendors,
               COUNT(*) AS n_contracts,
               SUM({ds.amount_col})::numeric AS total_amount
        FROM {ds.table}
        WHERE {ds.category_col} = %(cat)s
          AND {ds.amount_col} IS NOT NULL
          AND {ds.amount_col} > 0
    """
    rows = query(sql, {"cat": category})
    r = rows[0] if rows else {}
    n_vendors = int(r.get("n_vendors") or 0)

    return MathResult(
        value=n_vendors,
        formula_id="competition_count",
        sql=sql.strip(),
        source_rows=[r] if r else [],
        trace_steps=[
            {"step": "distinct_vendors", "value": n_vendors},
            {"step": "total_contracts", "value": int(r.get("n_contracts") or 0)},
            {"step": "total_amount", "value": float(r.get("total_amount") or 0)},
        ],
        references=[],
        inputs={"dataset": dataset, "category": category},
    )
