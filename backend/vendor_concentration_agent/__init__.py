"""Vendor Concentration agent — Agency 2026 hackathon.

Public surface re-exports the orchestrator entrypoint and the math layer's
result type so the FastAPI layer (`agent/api.py`) can import without
reaching into private modules.
"""

from vendor_concentration_agent.math.types import MathResult

__all__ = ["MathResult"]
