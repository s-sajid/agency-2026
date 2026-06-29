"""Read-only dashboard endpoints backed by the local April JSONL dataset."""

from __future__ import annotations

import functools
import inspect
import logging
import threading
import time
from collections import defaultdict
from typing import Any, Callable

from fastapi import APIRouter, HTTPException

from vendor_concentration_agent.data import local
from vendor_concentration_agent.jobstore import (
    dashboard_cache_get,
    dashboard_cache_set,
)

logger = logging.getLogger(__name__)


# Two-layer TTL cache:
#   L1: in-process dict
#   L2: SQLite on the vendor-agent Volume
_DASHBOARD_TTL_SECONDS = 3600

_cache: dict[Any, tuple[float, Any]] = {}
_cache_lock = threading.Lock()


def cached_dashboard(ttl: int = _DASHBOARD_TTL_SECONDS) -> Callable:
    def decorator(fn: Callable) -> Callable:
        sig = inspect.signature(fn)

        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            bound = sig.bind(*args, **kwargs)
            bound.apply_defaults()
            key_tuple = (
                local.data_cache_key(),
                fn.__name__,
                tuple(sorted(bound.arguments.items())),
            )

            now = time.time()

            with _cache_lock:
                hit = _cache.get(key_tuple)
                if hit and (now - hit[0]) < ttl:
                    return hit[1]

            key_str = repr(key_tuple)
            try:
                disk_value = dashboard_cache_get(key_str)
            except Exception as e:
                logger.warning("dashboard_cache_get failed for %s: %s", fn.__name__, e)
                disk_value = None
            if disk_value is not None:
                with _cache_lock:
                    _cache[key_tuple] = (now, disk_value)
                return disk_value

            result = await fn(*args, **kwargs)
            with _cache_lock:
                _cache[key_tuple] = (now, result)
            try:
                dashboard_cache_set(key_str, result, ttl)
            except Exception as e:
                logger.warning("dashboard_cache_set failed for %s: %s", fn.__name__, e)
            return result

        return wrapper
    return decorator


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _hhi(vendor_totals: dict[str, float]) -> float:
    total = sum(vendor_totals.values())
    if total <= 0:
        return 0.0
    return sum((amount / total) ** 2 for amount in vendor_totals.values()) * 10000


def _band(hhi: int) -> str:
    return "HIGH" if hhi > 2500 else "MODERATE" if hhi >= 1500 else "LOW"


def _contracts_with_amount() -> tuple[dict[str, Any], ...]:
    return tuple(r for r in local.ab_contracts() if r.get("amount") is not None)


@router.get("/metrics")
@cached_dashboard()
async def metrics():
    rows = _contracts_with_amount()
    return {
        "total_contracts": len(rows),
        "total_spend": sum(float(r.get("amount") or 0) for r in rows),
        "unique_vendors": len({r.get("recipient") for r in rows if r.get("recipient") is not None}),
    }


@router.get("/top-vendors")
@cached_dashboard()
async def top_vendors(limit: int = 10):
    totals: dict[str, dict[str, float | int]] = {}
    for row in _contracts_with_amount():
        recipient = local.norm_recipient(row.get("recipient"))
        if recipient is None:
            continue
        entry = totals.setdefault(recipient, {"contract_count": 0, "total_amount": 0.0})
        entry["contract_count"] = int(entry["contract_count"]) + 1
        entry["total_amount"] = float(entry["total_amount"]) + float(row.get("amount") or 0)

    ranked = sorted(totals.items(), key=lambda item: float(item[1]["total_amount"]), reverse=True)
    return [
        {
            "recipient": recipient,
            "contract_count": int(values["contract_count"]),
            "total_amount": float(values["total_amount"]),
        }
        for recipient, values in ranked[:limit]
    ]


def _department_vendor_totals() -> dict[str, dict[str, float]]:
    grouped: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for row in _contracts_with_amount():
        ministry = local.norm_ministry(row.get("ministry"))
        recipient = local.norm_recipient(row.get("recipient"))
        if ministry is None or recipient is None:
            continue
        grouped[ministry][recipient] += float(row.get("amount") or 0)
    return {dept: dict(vendors) for dept, vendors in grouped.items()}


@router.get("/concentration")
@cached_dashboard()
async def concentration(limit: int = 5):
    try:
        rows = []
        for department, vendor_totals in _department_vendor_totals().items():
            hhi = int(_hhi(vendor_totals))
            rows.append({"department": department, "hhi": hhi, "band": _band(hhi)})
        rows.sort(key=lambda r: r["hhi"], reverse=True)
        return rows[:limit]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/concentration-scatter")
@cached_dashboard()
async def concentration_scatter():
    try:
        rows = []
        for department, vendor_totals in _department_vendor_totals().items():
            hhi = int(_hhi(vendor_totals))
            rows.append({
                "department": department,
                "hhi": hhi,
                "band": _band(hhi),
                "total_spend": sum(vendor_totals.values()),
                "vendor_count": len(vendor_totals),
            })
        rows.sort(key=lambda r: r["total_spend"], reverse=True)
        return rows
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/vendor-dominance")
@cached_dashboard()
async def vendor_dominance(limit: int = 12):
    try:
        department_totals: dict[str, float] = defaultdict(float)
        vendor_totals: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))

        for row in _contracts_with_amount():
            ministry = local.norm_ministry(row.get("ministry"))
            if ministry is None:
                continue
            amount = float(row.get("amount") or 0)
            department_totals[ministry] += amount
            recipient = local.norm_recipient(row.get("recipient"))
            if recipient is not None:
                vendor_totals[ministry][recipient] += amount

        top_departments = sorted(department_totals.items(), key=lambda item: item[1], reverse=True)[:limit]
        result = []
        for department, total_spend in top_departments:
            vendors = vendor_totals.get(department) or {}
            if not vendors:
                continue
            top_vendor, vendor_spend = max(vendors.items(), key=lambda item: item[1])
            result.append({
                "department": department,
                "total_spend": total_spend,
                "top_vendor": top_vendor,
                "vendor_spend": vendor_spend,
                "dominance_pct": (vendor_spend / total_spend * 100) if total_spend else 0.0,
            })
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/spend-by-year")
@cached_dashboard()
async def spend_by_year():
    try:
        totals: dict[int, float] = defaultdict(float)
        for row in _contracts_with_amount():
            year = local.fiscal_year_start(row.get("display_fiscal_year"))
            if year is not None:
                totals[year] += float(row.get("amount") or 0)
        return [
            {"year": year, "total_spend": amount}
            for year, amount in sorted(totals.items())
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/concentration-trend")
@cached_dashboard()
async def concentration_trend():
    try:
        overall = _department_vendor_totals()
        top_depts = {
            dept
            for dept, _ in sorted(
                ((dept, _hhi(vendors)) for dept, vendors in overall.items()),
                key=lambda item: item[1],
                reverse=True,
            )[:5]
        }

        yearly_vendor_totals: dict[tuple[int, str], dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for row in _contracts_with_amount():
            ministry = local.norm_ministry(row.get("ministry"))
            if ministry not in top_depts:
                continue
            recipient = local.norm_recipient(row.get("recipient"))
            year = local.fiscal_year_start(row.get("display_fiscal_year"))
            if recipient is None or year is None:
                continue
            yearly_vendor_totals[(year, ministry)][recipient] += float(row.get("amount") or 0)

        rows = [
            {"year": year, "department": department, "hhi": int(round(_hhi(vendors)))}
            for (year, department), vendors in yearly_vendor_totals.items()
        ]
        rows.sort(key=lambda r: (r["year"], r["department"]))
        return rows
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/vendor-competition")
@cached_dashboard()
async def vendor_competition():
    try:
        first_year: dict[str, int] = {}
        yearly_spend: dict[tuple[int, str], float] = defaultdict(float)

        for row in _contracts_with_amount():
            recipient = local.norm_recipient(row.get("recipient"))
            year = local.fiscal_year_start(row.get("display_fiscal_year"))
            if recipient is None or year is None:
                continue
            first_year[recipient] = min(first_year.get(recipient, year), year)
            yearly_spend[(year, recipient)] += float(row.get("amount") or 0)

        by_year: dict[int, dict[str, float | set[str]]] = defaultdict(
            lambda: {
                "new_spend": 0.0,
                "returning_spend": 0.0,
                "new_recipients": set(),
                "returning_recipients": set(),
            }
        )
        for (year, recipient), spend in yearly_spend.items():
            bucket = by_year[year]
            if first_year.get(recipient) == year:
                bucket["new_spend"] = float(bucket["new_spend"]) + spend
                bucket["new_recipients"].add(recipient)  # type: ignore[union-attr]
            elif first_year.get(recipient, year) < year:
                bucket["returning_spend"] = float(bucket["returning_spend"]) + spend
                bucket["returning_recipients"].add(recipient)  # type: ignore[union-attr]

        return [
            {
                "year": year,
                "new_spend": float(values["new_spend"]),
                "returning_spend": float(values["returning_spend"]),
                "new_count": len(values["new_recipients"]),  # type: ignore[arg-type]
                "returning_count": len(values["returning_recipients"]),  # type: ignore[arg-type]
            }
            for year, values in sorted(by_year.items())
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _bucket(amount: float) -> tuple[int, str]:
    if amount < 10_000:
        return 1, "<$10K"
    if amount < 25_000:
        return 2, "$10-25K"
    if amount < 50_000:
        return 3, "$25-50K"
    if amount < 75_000:
        return 4, "$50-75K"
    if amount < 100_000:
        return 5, "$75-100K"
    if amount < 250_000:
        return 6, "$100-250K"
    if amount < 500_000:
        return 7, "$250-500K"
    if amount < 1_000_000:
        return 8, "$500K-1M"
    return 9, "$1M+"


@router.get("/contract-distribution")
@cached_dashboard()
async def contract_distribution():
    try:
        totals: dict[int, dict[str, Any]] = {}
        for row in _contracts_with_amount():
            amount = row.get("amount")
            if amount is None or amount <= 0:
                continue
            bucket_id, label = _bucket(float(amount))
            entry = totals.setdefault(bucket_id, {
                "bucket_id": bucket_id,
                "bucket": label,
                "contract_count": 0,
                "total_amount": 0.0,
            })
            entry["contract_count"] += 1
            entry["total_amount"] += float(amount)
        return [totals[bucket_id] for bucket_id in sorted(totals)]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
