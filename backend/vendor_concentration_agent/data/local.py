"""Local JSONL data access for the demo deployment.

The hackathon Postgres replica is no longer available, but the deployed
backend only needs two small Alberta JSONL files. This module loads those
backend-owned files directly and exposes deterministic helpers for the
dashboard and math layers.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from vendor_concentration_agent.data.datasets import get as _get_dataset

DATA_DIR_ENV = "LOCAL_DATA_DIR"
DATA_DIR_NAME = "data"
LEGACY_DATASET_DIR_NAME = "april-26-hackathon-dataset"


def _candidate_roots() -> Iterable[Path]:
    env = os.getenv(DATA_DIR_ENV)
    if env:
        yield Path(env)

    cwd = Path.cwd()
    yield cwd / DATA_DIR_NAME
    yield cwd.parent / DATA_DIR_NAME

    here = Path(__file__).resolve()
    for parent in here.parents:
        yield parent / DATA_DIR_NAME
        yield parent.parent / DATA_DIR_NAME

    # Backward-compatible local fallback while old working trees still
    # have the original full dataset next to the repo.
    yield cwd / LEGACY_DATASET_DIR_NAME
    yield cwd.parent / LEGACY_DATASET_DIR_NAME


@lru_cache(maxsize=1)
def dataset_root() -> Path:
    seen: set[Path] = set()
    for candidate in _candidate_roots():
        candidate = candidate.resolve()
        if candidate in seen:
            continue
        seen.add(candidate)
        if (candidate / "ab_contracts.jsonl").exists() or (candidate / "ab" / "ab_contracts.jsonl").exists():
            return candidate
    checked = ", ".join(str(p) for p in seen)
    raise FileNotFoundError(
        f"Could not find backend demo data. Set {DATA_DIR_ENV} to the directory with the JSONL files. "
        f"Checked: {checked}"
    )


def data_path(*parts: str, required: bool = True) -> Path:
    root = dataset_root()
    path = root.joinpath(*parts)
    if not path.exists() and len(parts) == 1:
        for subdir in ("ab", "general"):
            nested = root / subdir / parts[0]
            if nested.exists():
                path = nested
                break
    if not path.exists() and len(parts) == 2 and parts[0] in {"ab", "general"}:
        path = root / parts[1]
    if required and not path.exists():
        raise FileNotFoundError(f"Missing local dataset file: {path}")
    return path


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _load_jsonl(path: Path) -> tuple[dict[str, Any], ...]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            if "amount" in row:
                row["amount"] = _to_float(row.get("amount"))
            rows.append(row)
    return tuple(rows)


@lru_cache(maxsize=1)
def ab_contracts() -> tuple[dict[str, Any], ...]:
    return _load_jsonl(data_path("ab_contracts.jsonl"))


@lru_cache(maxsize=1)
def ab_sole_source() -> tuple[dict[str, Any], ...]:
    return _load_jsonl(data_path("ab_sole_source.jsonl"))


def rows_for_dataset(dataset: str) -> tuple[dict[str, Any], ...]:
    if dataset == "ab_contracts":
        return ab_contracts()
    if dataset == "ab_sole_source":
        return ab_sole_source()
    raise ValueError(f"Local JSONL data is not configured for dataset {dataset!r}")


def data_cache_key() -> str:
    parts = []
    for rel in (
        ("ab_contracts.jsonl",),
        ("ab_sole_source.jsonl",),
    ):
        path = data_path(*rel)
        stat = path.stat()
        parts.append(f"{'/'.join(rel)}:{stat.st_mtime_ns}:{stat.st_size}")
    return "local-jsonl:" + "|".join(parts)


def norm_ministry(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    name = value.strip()
    if not name:
        return None
    if name in {
        "Children's Services",
        "Children and Family Services",
        "Children & Family Services",
    }:
        return "Children's Services"
    if name in {
        "Community and Social Services",
        "Seniors, Community and Social Services",
        "Seniors and Community and Social Services",
    }:
        return "Seniors, Community and Social Services"
    return name


def norm_recipient(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    name = value.strip()
    if not name:
        return None
    if name in {
        "Receiver General for Canada",
        "Receiver General of Canada",
        "Canada Revenue Agency",
    }:
        return "Canada Revenue Agency"
    return name


def fiscal_year_start(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    prefix = value[:4]
    return int(prefix) if prefix.isdigit() else None


def vendor_amounts(dataset: str, category: str) -> list[dict[str, Any]]:
    ds = _get_dataset(dataset)
    if ds.category_col is None:
        raise ValueError(f"dataset {dataset!r} has no category column")

    totals: dict[str | None, float] = {}
    for row in rows_for_dataset(dataset):
        amount = row.get(ds.amount_col)
        if row.get(ds.category_col) != category or amount is None or amount <= 0:
            continue
        vendor = row.get(ds.vendor_col)
        totals[vendor] = totals.get(vendor, 0.0) + float(amount)

    return [
        {"vendor": vendor, "vendor_amt": amount}
        for vendor, amount in sorted(totals.items(), key=lambda item: item[1], reverse=True)
    ]


def top_concentrated_rows(dataset: str, min_total: float, limit: int) -> list[dict[str, Any]]:
    ds = _get_dataset(dataset)
    if ds.category_col is None:
        raise ValueError(f"dataset {dataset!r} has no category column")

    by_category: dict[str, dict[str | None, float]] = {}
    for row in rows_for_dataset(dataset):
        category = row.get(ds.category_col)
        amount = row.get(ds.amount_col)
        if not category or amount is None or amount <= 0:
            continue
        vendor = row.get(ds.vendor_col)
        vendor_totals = by_category.setdefault(category, {})
        vendor_totals[vendor] = vendor_totals.get(vendor, 0.0) + float(amount)

    ranked: list[dict[str, Any]] = []
    for category, vendor_totals in by_category.items():
        cat_total = sum(vendor_totals.values())
        if cat_total < min_total:
            continue
        top_vendor, top_amount = max(vendor_totals.items(), key=lambda item: item[1])
        ranked.append({
            "category": category,
            "top_vendor": top_vendor,
            "cat_total": cat_total,
            "vendor_count": len([v for v in vendor_totals if v is not None]),
            "top1_share_pct": 100.0 * top_amount / cat_total if cat_total else 0.0,
        })

    ranked.sort(key=lambda r: (r["top1_share_pct"], r["cat_total"]), reverse=True)
    return ranked[:limit]


def stream_entity_records() -> Iterable[dict[str, Any]]:
    path = data_path("entity_golden_records.jsonl", required=False)
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def find_entity_record(name: str) -> dict[str, Any] | None:
    needle = name.casefold().strip()
    if not needle:
        return None
    best: dict[str, Any] | None = None
    best_count = -1
    for row in stream_entity_records():
        canonical = str(row.get("canonical_name") or "").casefold()
        norm = str(row.get("norm_name") or "").casefold()
        if needle not in canonical and needle not in norm:
            continue
        count = int(row.get("source_link_count") or 0)
        if count > best_count:
            best = row
            best_count = count
    return best
