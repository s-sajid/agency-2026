"""Lookup table mapping a logical dataset name to its concrete column names.

Adding a new dataset to the system means adding one entry here, not changing
the math functions. This is what lets the same hhi() call work against
ab.ab_sole_source, ab.ab_contracts, fed.grants_contributions, etc.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DatasetSpec:
    table: str
    vendor_col: str
    amount_col: str
    category_col: str | None
    ministry_col: str | None
    fiscal_year_col: str | None
    description: str


DATASETS: dict[str, DatasetSpec] = {
    "ab_sole_source": DatasetSpec(
        table="ab.ab_sole_source",
        vendor_col="vendor",
        amount_col="amount",
        category_col="contract_services",
        ministry_col="ministry",
        fiscal_year_col="display_fiscal_year",
        description="Alberta sole-source procurement (no competitive bid).",
    ),
    "ab_contracts": DatasetSpec(
        table="ab.ab_contracts",
        vendor_col="recipient",
        amount_col="amount",
        category_col=None,  # no category field; ministry serves as the slice
        ministry_col="ministry",
        fiscal_year_col="display_fiscal_year",
        description="Alberta competitively-procured contracts.",
    ),
    "fed_grants": DatasetSpec(
        table="fed.grants_contributions",
        vendor_col="recipient_legal_name",
        amount_col="agreement_value",
        category_col=None,
        ministry_col="owner_org",
        fiscal_year_col=None,
        description="Federal grants and contributions (open.canada.ca).",
    ),
}


def get(name: str) -> DatasetSpec:
    if name not in DATASETS:
        raise KeyError(f"unknown dataset: {name}. Known: {sorted(DATASETS)}")
    return DATASETS[name]
