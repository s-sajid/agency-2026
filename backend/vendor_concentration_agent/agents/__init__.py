"""Per-agent factories. Each builds a configured strands.Agent instance."""

from vendor_concentration_agent.agents.router import build_router_agent
from vendor_concentration_agent.agents.discovery import build_discovery_agent
from vendor_concentration_agent.agents.investigation import build_investigation_agent
from vendor_concentration_agent.agents.validator import build_validator_agent
from vendor_concentration_agent.agents.narrative import build_narrative_agent

__all__ = [
    "build_router_agent",
    "build_discovery_agent",
    "build_investigation_agent",
    "build_validator_agent",
    "build_narrative_agent",
]
