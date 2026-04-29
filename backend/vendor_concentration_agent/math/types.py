"""Shape contract for every math layer function."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class MathResult:
    """The single return shape every math function uses."""

    value: Any
    formula_id: str
    sql: str
    source_rows: list[dict[str, Any]] = field(default_factory=list)
    trace_steps: list[dict[str, Any]] = field(default_factory=list)
    references: list[str] = field(default_factory=list)
    inputs: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
