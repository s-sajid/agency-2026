"""Tolerant JSON extraction. Models often wrap JSON in markdown fences or
prepend a sentence; this strips both and pulls out the first valid object.
"""

from __future__ import annotations

import json
import re


_OBJECT_RE = re.compile(r"\{[\s\S]*\}", re.MULTILINE)


def extract_json(text: str) -> dict | None:
    """Return the first JSON object found in `text`, or None."""
    if not text:
        return None
    text = text.strip()
    # Strip ```json ... ``` fences
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    # Try the whole thing
    try:
        v = json.loads(text)
        return v if isinstance(v, dict) else None
    except json.JSONDecodeError:
        pass

    # Then find the largest balanced { ... } block
    m = _OBJECT_RE.search(text)
    if not m:
        return None
    candidate = m.group()
    # Walk back from the end if extra trailing content broke parsing
    for end in range(len(candidate), 0, -1):
        try:
            v = json.loads(candidate[:end])
            return v if isinstance(v, dict) else None
        except json.JSONDecodeError:
            continue
    return None
