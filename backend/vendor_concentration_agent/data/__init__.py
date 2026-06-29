"""Data access — local JSONL files, Postgres fallback helpers, dataset registry."""

from vendor_concentration_agent.data.datasets import DATASETS, DatasetSpec, get
from vendor_concentration_agent.data.postgres import query, scalar

__all__ = ["DATASETS", "DatasetSpec", "get", "query", "scalar"]
