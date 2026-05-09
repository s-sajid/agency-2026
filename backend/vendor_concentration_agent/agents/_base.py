"""Shared agent construction helpers — model provider + prompt loading.

`LLM_PROVIDER` selects the backend: `ollama` (default, Ollama Cloud) or
`bedrock` (legacy AWS path, retained so the AWS deployment branch still
works). All five agents share one cached model instance.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"

LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "ollama").lower()

DEFAULT_MODEL = (
    os.environ.get("LLM_MODEL")
    or os.environ.get("AGENT_MODEL_ID")
    or ("gemma4:31b-cloud" if LLM_PROVIDER == "ollama" else "us.anthropic.claude-sonnet-4-6")
)


@lru_cache(maxsize=1)
def shared_model():
    """One model instance shared across all five agents."""
    if LLM_PROVIDER == "ollama":
        from strands.models import OllamaModel

        host = os.environ.get("OLLAMA_HOST", "https://ollama.com")
        api_key = os.environ.get("OLLAMA_CLOUD_API_KEY") or os.environ.get("OLLAMA_API_KEY")
        client_args: dict = {}
        if api_key:
            client_args["headers"] = {"Authorization": f"Bearer {api_key}"}
        return OllamaModel(
            host=host,
            ollama_client_args=client_args or None,
            model_id=DEFAULT_MODEL,
        )

    if LLM_PROVIDER == "bedrock":
        from strands.models import BedrockModel

        region = os.environ.get("AWS_REGION", "us-west-2")
        return BedrockModel(model_id=DEFAULT_MODEL, region_name=region)

    raise ValueError(f"Unknown LLM_PROVIDER={LLM_PROVIDER!r} (expected 'ollama' or 'bedrock')")


def load_prompt(name: str) -> str:
    """Load a system prompt from prompts/<name>.md."""
    path = PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"prompt not found: {path}")
    return path.read_text(encoding="utf-8")
