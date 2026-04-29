"""Shared agent construction helpers — Bedrock model + prompt loading."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from strands.models import BedrockModel
from dotenv import load_dotenv

load_dotenv()

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"

# Default model — read from .env (LLM_MODEL) which the hackathon-prep work
# already configured with the active Bedrock model ID. Sonnet 4 / 4.6 strikes
# the right balance of speed and capability for a 4-agent pipeline running live.
DEFAULT_MODEL = (
    os.environ.get("LLM_MODEL")
    or os.environ.get("AGENT_MODEL_ID")
    or "us.anthropic.claude-sonnet-4-6"
)
DEFAULT_REGION = os.environ.get("AWS_REGION", "us-west-2")


@lru_cache(maxsize=1)
def shared_model() -> BedrockModel:
    """One BedrockModel instance shared across all five agents — cheaper
    than constructing per-call and identical config for every role.
    """
    return BedrockModel(model_id=DEFAULT_MODEL, region_name=DEFAULT_REGION)


def load_prompt(name: str) -> str:
    """Load a system prompt from prompts/<name>.md."""
    path = PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"prompt not found: {path}")
    return path.read_text(encoding="utf-8")
