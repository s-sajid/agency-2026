"""Read-only dashboard endpoints — vendored from agency-prep/backend/api.py.

These power the homepage charts (`MetricsSummary`, `TopVendorsChart`,
`ConcentrationChart`, `ConcentrationScatterChart`, `VendorDominanceChart`,
`SpendOverTimeChart`, `ConcentrationTrendChart`, `VendorCompetitionChart`,
`ThresholdDistributionChart`).

SQL is unchanged from agency-prep — same ministry/recipient normalization
helpers, same HHI band thresholds (DOJ/FTC), same response shapes the
frontend's lib/api.ts expects.

Uses connectorx + polars (matches agency-prep's choice). Reads DATABASE_URL
or PG_DSN — both work, so existing .env files don't need changing.
"""

from __future__ import annotations

import os

import polars as pl
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException

load_dotenv()

# Accept either env-var name. agency-prep uses DATABASE_URL; we use PG_DSN.
_URI = os.environ.get("DATABASE_URL") or os.environ.get("PG_DSN")
if not _URI:
    raise RuntimeError(
        "Neither DATABASE_URL nor PG_DSN is set. "
        "Copy .env.example to .env and fill in the Postgres DSN."
    )
# connectorx requires sslmode in the URI for Render-hosted databases
_CX_URI = _URI if "sslmode" in _URI else _URI + "?sslmode=require"


def _query(sql: str) -> pl.DataFrame:
    return pl.read_database_uri(sql, _CX_URI)


# Ministry name normalization — maps known variant spellings to a single canonical name.
# Must be applied in a base CTE before any GROUP BY on ministry.
_NORM_MINISTRY = r"""
    CASE
        WHEN TRIM(ministry) IN (
            'Children''s Services',
            'Children and Family Services',
            'Children & Family Services'
        ) THEN 'Children''s Services'
        WHEN TRIM(ministry) IN (
            'Community and Social Services',
            'Seniors, Community and Social Services',
            'Seniors and Community and Social Services'
        ) THEN 'Seniors, Community and Social Services'
        ELSE TRIM(ministry)
    END
""".strip()

# Recipient name normalization — Receiver General for Canada IS Canada Revenue Agency.
_NORM_RECIPIENT = r"""
    CASE
        WHEN TRIM(recipient) IN (
            'Receiver General for Canada',
            'Receiver General of Canada',
            'Canada Revenue Agency'
        ) THEN 'Canada Revenue Agency'
        ELSE TRIM(recipient)
    END
""".strip()


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/metrics")
async def metrics():
    df = _query("""
        SELECT
            COUNT(*)                    AS total_contracts,
            SUM(amount)::float8         AS total_spend,
            COUNT(DISTINCT recipient)   AS unique_vendors
        FROM ab.ab_contracts
        WHERE amount IS NOT NULL
    """)
    row = df.row(0, named=True)
    return {
        "total_contracts": int(row["total_contracts"]),
        "total_spend":     float(row["total_spend"] or 0),
        "unique_vendors":  int(row["unique_vendors"]),
    }


@router.get("/top-vendors")
async def top_vendors(limit: int = 10):
    df = _query(f"""
        WITH normed AS (
            SELECT {_NORM_RECIPIENT} AS recipient, amount
            FROM ab.ab_contracts
            WHERE amount IS NOT NULL AND recipient IS NOT NULL
        )
        SELECT
            recipient,
            COUNT(*)::integer        AS contract_count,
            SUM(amount)::float8      AS total_amount
        FROM normed
        GROUP BY recipient
        ORDER BY total_amount DESC
        LIMIT {limit}
    """)
    return [
        {
            "recipient":      str(row["recipient"]),
            "contract_count": int(row["contract_count"]),
            "total_amount":   float(row["total_amount"] or 0),
        }
        for row in df.to_dicts()
    ]


@router.get("/concentration")
async def concentration(limit: int = 5):
    try:
        df = _query(f"""
            WITH normed AS (
                SELECT {_NORM_MINISTRY} AS ministry, {_NORM_RECIPIENT} AS recipient, amount
                FROM ab.ab_contracts
                WHERE amount IS NOT NULL AND recipient IS NOT NULL AND ministry IS NOT NULL
            ),
            vendor_totals AS (
                SELECT ministry AS grp, recipient AS vendor,
                       SUM(amount)::float8 AS vendor_total
                FROM normed
                GROUP BY ministry, recipient
            ),
            group_totals AS (
                SELECT grp, SUM(vendor_total)::float8 AS group_total
                FROM vendor_totals
                GROUP BY grp
            ),
            hhi_calc AS (
                SELECT vt.grp,
                       SUM(POWER(vt.vendor_total / gt.group_total, 2))::float8 AS hhi_raw
                FROM vendor_totals vt
                JOIN group_totals gt ON vt.grp = gt.grp
                GROUP BY vt.grp
            )
            SELECT gt.grp AS department, (hc.hhi_raw * 10000)::float8 AS hhi_float
            FROM group_totals gt
            JOIN hhi_calc hc ON gt.grp = hc.grp
            ORDER BY hhi_float DESC
            LIMIT {limit}
        """)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    result = []
    for row in df.to_dicts():
        hhi = int(float(row["hhi_float"]))
        result.append({
            "department": str(row["department"]),
            "hhi":        hhi,
            "band":       "HIGH" if hhi > 2500 else "MODERATE" if hhi >= 1500 else "LOW",
        })
    return result


@router.get("/concentration-scatter")
async def concentration_scatter():
    try:
        df = _query(f"""
            WITH normed AS (
                SELECT {_NORM_MINISTRY} AS ministry, {_NORM_RECIPIENT} AS recipient, amount
                FROM ab.ab_contracts
                WHERE amount IS NOT NULL AND recipient IS NOT NULL AND ministry IS NOT NULL
            ),
            vendor_totals AS (
                SELECT ministry AS grp, recipient AS vendor,
                       SUM(amount)::float8 AS vendor_total
                FROM normed
                GROUP BY ministry, recipient
            ),
            group_totals AS (
                SELECT grp,
                       SUM(vendor_total)::float8  AS group_total,
                       COUNT(DISTINCT vendor)::integer AS vendor_count
                FROM vendor_totals
                GROUP BY grp
            ),
            hhi_calc AS (
                SELECT vt.grp,
                       SUM(POWER(vt.vendor_total / gt.group_total, 2))::float8 AS hhi_raw
                FROM vendor_totals vt
                JOIN group_totals gt ON vt.grp = gt.grp
                GROUP BY vt.grp
            )
            SELECT
                gt.grp                          AS department,
                (hc.hhi_raw * 10000)::float8    AS hhi_float,
                gt.group_total                  AS total_spend,
                gt.vendor_count
            FROM group_totals gt
            JOIN hhi_calc hc ON gt.grp = hc.grp
            ORDER BY gt.group_total DESC
        """)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    result = []
    for row in df.to_dicts():
        hhi = int(float(row["hhi_float"]))
        result.append({
            "department":   str(row["department"]),
            "hhi":          hhi,
            "band":         "HIGH" if hhi > 2500 else "MODERATE" if hhi >= 1500 else "LOW",
            "total_spend":  float(row["total_spend"] or 0),
            "vendor_count": int(row["vendor_count"] or 0),
        })
    return result


@router.get("/vendor-dominance")
async def vendor_dominance(limit: int = 12):
    try:
        df = _query(f"""
            WITH normed AS (
                SELECT {_NORM_MINISTRY} AS ministry, {_NORM_RECIPIENT} AS recipient, amount
                FROM ab.ab_contracts
                WHERE amount IS NOT NULL AND ministry IS NOT NULL
            ),
            ministry_totals AS (
                SELECT ministry,
                       SUM(amount)::float8 AS total_spend
                FROM normed
                GROUP BY ministry
                ORDER BY total_spend DESC
                LIMIT {limit}
            ),
            vendor_spend AS (
                SELECT n.ministry, n.recipient,
                       SUM(n.amount)::float8 AS vendor_total
                FROM normed n
                JOIN ministry_totals mt ON n.ministry = mt.ministry
                WHERE n.recipient IS NOT NULL
                GROUP BY n.ministry, n.recipient
            ),
            ranked AS (
                SELECT ministry, recipient,
                       vendor_total,
                       ROW_NUMBER() OVER (PARTITION BY ministry ORDER BY vendor_total DESC) AS rn
                FROM vendor_spend
            )
            SELECT
                mt.ministry     AS department,
                mt.total_spend,
                r.recipient     AS top_vendor,
                r.vendor_total  AS vendor_spend,
                (r.vendor_total / mt.total_spend * 100)::float8 AS dominance_pct
            FROM ministry_totals mt
            JOIN ranked r ON mt.ministry = r.ministry AND r.rn = 1
            ORDER BY mt.total_spend DESC
        """)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return [
        {
            "department":    str(r["department"]),
            "total_spend":   float(r["total_spend"] or 0),
            "top_vendor":    str(r["top_vendor"]),
            "vendor_spend":  float(r["vendor_spend"] or 0),
            "dominance_pct": float(r["dominance_pct"] or 0),
        }
        for r in df.to_dicts()
    ]


@router.get("/spend-by-year")
async def spend_by_year():
    try:
        df = _query("""
            SELECT
                LEFT(display_fiscal_year, 4)::integer AS year,
                SUM(amount)::float8                   AS total_spend
            FROM ab.ab_contracts
            WHERE display_fiscal_year IS NOT NULL
              AND amount IS NOT NULL
            GROUP BY LEFT(display_fiscal_year, 4)
            ORDER BY year ASC
        """)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return [
        {"year": int(row["year"]), "total_spend": float(row["total_spend"] or 0)}
        for row in df.to_dicts()
    ]


@router.get("/concentration-trend")
async def concentration_trend():
    try:
        df = _query(f"""
            WITH normed AS (
                SELECT {_NORM_MINISTRY} AS ministry, {_NORM_RECIPIENT} AS recipient, amount, display_fiscal_year
                FROM ab.ab_contracts
                WHERE amount IS NOT NULL AND ministry IS NOT NULL
            ),
            vendor_totals AS (
                SELECT ministry, recipient, SUM(amount)::float8 AS vendor_total
                FROM normed
                WHERE recipient IS NOT NULL
                GROUP BY ministry, recipient
            ),
            group_totals AS (
                SELECT ministry, SUM(vendor_total)::float8 AS group_total
                FROM vendor_totals GROUP BY ministry
            ),
            overall_hhi AS (
                SELECT vt.ministry,
                       (SUM(POWER(vt.vendor_total / gt.group_total, 2)) * 10000)::float8 AS hhi
                FROM vendor_totals vt
                JOIN group_totals gt ON vt.ministry = gt.ministry
                GROUP BY vt.ministry
            ),
            top_depts AS (
                SELECT ministry FROM overall_hhi ORDER BY hhi DESC LIMIT 5
            ),
            yearly_vendor_totals AS (
                SELECT
                    n.ministry,
                    n.recipient,
                    LEFT(n.display_fiscal_year, 4)::integer AS year,
                    SUM(n.amount)::float8 AS vendor_total
                FROM normed n
                JOIN top_depts td ON n.ministry = td.ministry
                WHERE n.recipient IS NOT NULL AND n.display_fiscal_year IS NOT NULL
                GROUP BY n.ministry, n.recipient, LEFT(n.display_fiscal_year, 4)::integer
            ),
            yearly_group_totals AS (
                SELECT ministry, year, SUM(vendor_total)::float8 AS group_total
                FROM yearly_vendor_totals GROUP BY ministry, year
            )
            SELECT
                yvt.year,
                yvt.ministry AS department,
                ROUND(SUM(POWER(yvt.vendor_total / ygt.group_total, 2)) * 10000)::integer AS hhi
            FROM yearly_vendor_totals yvt
            JOIN yearly_group_totals ygt
              ON yvt.ministry = ygt.ministry AND yvt.year = ygt.year
            GROUP BY yvt.year, yvt.ministry
            ORDER BY yvt.year ASC, yvt.ministry ASC
        """)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return [
        {"year": int(r["year"]), "department": str(r["department"]), "hhi": int(r["hhi"])}
        for r in df.to_dicts()
    ]


@router.get("/vendor-competition")
async def vendor_competition():
    try:
        df = _query(f"""
            WITH normed AS (
                SELECT {_NORM_RECIPIENT} AS recipient, amount, display_fiscal_year
                FROM ab.ab_contracts
                WHERE amount IS NOT NULL AND recipient IS NOT NULL AND display_fiscal_year IS NOT NULL
            ),
            first_year AS (
                SELECT
                    recipient,
                    MIN(LEFT(display_fiscal_year, 4)::integer) AS first_year
                FROM normed
                GROUP BY recipient
            ),
            yearly_spend AS (
                SELECT
                    LEFT(n.display_fiscal_year, 4)::integer AS year,
                    n.recipient,
                    SUM(n.amount)::float8 AS spend
                FROM normed n
                GROUP BY LEFT(n.display_fiscal_year, 4)::integer, n.recipient
            )
            SELECT
                y.year,
                COALESCE(SUM(CASE WHEN fy.first_year = y.year THEN y.spend END), 0)::float8
                    AS new_spend,
                COALESCE(SUM(CASE WHEN fy.first_year < y.year THEN y.spend END), 0)::float8
                    AS returning_spend,
                COUNT(DISTINCT CASE WHEN fy.first_year = y.year THEN y.recipient END)::integer
                    AS new_count,
                COUNT(DISTINCT CASE WHEN fy.first_year < y.year THEN y.recipient END)::integer
                    AS returning_count
            FROM yearly_spend y
            JOIN first_year fy ON y.recipient = fy.recipient
            GROUP BY y.year
            ORDER BY y.year ASC
        """)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return [
        {
            "year": int(r["year"]),
            "new_spend":        float(r["new_spend"] or 0),
            "returning_spend":  float(r["returning_spend"] or 0),
            "new_count":        int(r["new_count"] or 0),
            "returning_count":  int(r["returning_count"] or 0),
        }
        for r in df.to_dicts()
    ]


@router.get("/contract-distribution")
async def contract_distribution():
    try:
        df = _query("""
            SELECT
                CASE
                    WHEN amount < 10000   THEN 1
                    WHEN amount < 25000   THEN 2
                    WHEN amount < 50000   THEN 3
                    WHEN amount < 75000   THEN 4
                    WHEN amount < 100000  THEN 5
                    WHEN amount < 250000  THEN 6
                    WHEN amount < 500000  THEN 7
                    WHEN amount < 1000000 THEN 8
                    ELSE 9
                END AS bucket_id,
                CASE
                    WHEN amount < 10000   THEN '<$10K'
                    WHEN amount < 25000   THEN '$10–25K'
                    WHEN amount < 50000   THEN '$25–50K'
                    WHEN amount < 75000   THEN '$50–75K'
                    WHEN amount < 100000  THEN '$75–100K'
                    WHEN amount < 250000  THEN '$100–250K'
                    WHEN amount < 500000  THEN '$250–500K'
                    WHEN amount < 1000000 THEN '$500K–1M'
                    ELSE '$1M+'
                END AS bucket,
                COUNT(*)::integer       AS contract_count,
                SUM(amount)::float8     AS total_amount
            FROM ab.ab_contracts
            WHERE amount > 0 AND amount IS NOT NULL
            GROUP BY bucket_id, bucket
            ORDER BY bucket_id
        """)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return [
        {
            "bucket_id":      int(r["bucket_id"]),
            "bucket":         str(r["bucket"]),
            "contract_count": int(r["contract_count"]),
            "total_amount":   float(r["total_amount"] or 0),
        }
        for r in df.to_dicts()
    ]
