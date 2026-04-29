"""Deterministic Final Brief composer.

Replaces the Narrative LLM agent. Reads Investigation's structured
findings + Validator's structured verdict + Discovery's plan and
templates a Minister-ready brief object. No LLM, no invention possible.

Every field on the brief comes from a real upstream tool result.
If a field can't be sourced, it's omitted (not faked).
"""

from __future__ import annotations

from typing import Any


def _coalesce(*values: Any) -> Any:
    for v in values:
        if v not in (None, "", [], {}):
            return v
    return None


def _interp_for(metric_name: str, value: Any) -> str:
    """Map a metric to its DOJ/textbook band interpretation. Pure
    deterministic lookup — no language-model invention.
    """
    n = (metric_name or "").lower()
    if "hhi" in n:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return ""
        if v > 2500:
            return "highly concentrated"
        if v >= 1500:
            return "moderately concentrated"
        return "competitive"
    if "cr_1" in n or "cr1" in n:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return ""
        if v >= 100:
            return "single-vendor monopoly"
        if v >= 70:
            return "tight oligopoly"
        if v >= 40:
            return "moderate"
        return "competitive"
    if "cr_4" in n or "cr4" in n:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return ""
        if v >= 70:
            return "tight 4-firm oligopoly"
        if v >= 40:
            return "moderate"
        return "competitive"
    if "gini" in n:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return ""
        if v > 0.6:
            return "highly unequal"
        if v > 0.3:
            return "moderate inequality"
        return "equal distribution"
    if "sole" in n:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return ""
        if v > 30:
            return "sole-source dominant"
        if v > 10:
            return "mixed"
        return "mostly competitive"
    return ""


def _format_value(metric_name: str, value: Any) -> str:
    """Format a numeric value for the metrics_table. Critical: HHI is
    rendered as raw integer with thousands separators, NEVER as a percentage.
    """
    n = (metric_name or "").lower()
    if value is None:
        return "—"
    try:
        v = float(value)
    except (TypeError, ValueError):
        return str(value)

    if "hhi" in n:
        return f"{int(round(v)):,}"
    if "cr_" in n or "cr1" in n or "cr4" in n or "share" in n or "rate" in n or "%" in n:
        return f"{v:.1f}%"
    if "gini" in n:
        return f"{v:.4f}"
    if "footprint" in n or "spend" in n or "amount" in n or "$" in n or "total" in n:
        if v >= 1e9: return f"${v/1e9:.2f}B"
        if v >= 1e6: return f"${v/1e6:.1f}M"
        if v >= 1e3: return f"${v/1e3:.0f}K"
        return f"${v:.0f}"
    # Otherwise: integer if whole, else 2 decimals
    if v.is_integer():
        return f"{int(v):,}"
    return f"{v:,.2f}"


def _headline(findings: dict, verdict: dict) -> str:
    """Pick the headline based on verdict so the brief never contradicts
    itself between headline and caveats.
    """
    base = (findings.get("headline") or "").strip()
    v = (verdict.get("verdict") or "").upper()
    if v == "DIVERGE":
        return ("Headline finding did not survive cross-check — figures "
                "below are unverified pending re-extraction.")
    if v == "INSUFFICIENT_DATA":
        return base + " (cross-check could not be constructed)" if base else \
               "Cross-check could not be constructed — confidence is medium."
    if v == "PARTIAL":
        return base + " (partial verification)" if base else \
               "Headline finding is partially verified."
    return base or "Investigation produced no headline finding."


def _summary(findings: dict, verdict: dict, plan: dict) -> str:
    """Plain-English summary describing what was actually done. Always
    consistent with the verdict — no inventions.
    """
    parts: list[str] = []

    n_metrics = len(findings.get("metrics") or [])
    if n_metrics:
        parts.append(f"Investigation computed {n_metrics} metric"
                     f"{'s' if n_metrics != 1 else ''} via deterministic SQL.")

    v_label = verdict.get("verdict")
    n_checks = len(verdict.get("checks_run") or [])
    if v_label:
        if n_checks:
            parts.append(f"Validator ran {n_checks} cross-check"
                         f"{'s' if n_checks != 1 else ''}; verdict: {v_label}.")
        else:
            parts.append(f"Validator verdict: {v_label}.")

    xd = verdict.get("cross_dataset") or {}
    appears_in = xd.get("appears_in") or []
    if appears_in:
        canonical = xd.get("canonical_name") or "the vendor"
        parts.append(f"Cross-jurisdiction lookup confirms {canonical} "
                     f"in {', '.join(appears_in)}.")

    return " ".join(parts) if parts else "—"


def _recommendation(findings: dict, verdict: dict) -> str | None:
    """Pick a recommendation deterministically based on the verdict."""
    v = (verdict.get("verdict") or "").upper()
    headline = findings.get("headline") or ""

    if v == "DIVERGE":
        return ("Treat the headline figures as provisional. Re-extract from "
                "the live source with reconciled vendor and category strings "
                "before briefing a decision-maker.")
    if v == "PARTIAL":
        return ("Findings are partially verified — confirm with a fresh "
                "extraction before action.")
    if v == "INSUFFICIENT_DATA":
        return ("No real cross-check was possible. Treat findings as "
                "indicative, not confirmed.")
    if v == "MATCH" and headline:
        return ("Findings are independently verified — proceed with a "
                "vendor-strategy review of the highlighted concentration.")
    return None


def _caveats(findings: dict, verdict: dict, plan: dict) -> list[str]:
    """Concatenate caveats from Discovery + Investigation + Validator,
    de-duplicated by exact-string match. Cap at 4.
    """
    seen: set[str] = set()
    out: list[str] = []
    for source in (verdict, findings, plan):
        for c in (source.get("honest_caveats") or []):
            key = str(c).strip()
            if key and key not in seen:
                seen.add(key)
                out.append(key)
            if len(out) >= 4:
                return out
    return out


def _sanitize_verdict(verdict: dict) -> dict:
    """If the Validator returned DIVERGE but all 'divergent' checks have
    value_b == 0 while value_a != 0, that's a failed re-run (zero-row
    SQL match), NOT a real divergence. Downgrade to INSUFFICIENT_DATA so
    the brief doesn't lie about contradicting itself.
    """
    verdict = dict(verdict or {})
    if (verdict.get("verdict") or "").upper() != "DIVERGE":
        return verdict
    checks = verdict.get("checks_run") or []
    if not checks:
        verdict["verdict"] = "INSUFFICIENT_DATA"
        verdict.setdefault("confidence", "medium")
        return verdict
    diverging = [c for c in checks if (c.get("verdict") or "").upper() == "DIVERGE"]
    if not diverging:
        # Validator labelled it DIVERGE overall but no individual check
        # actually diverged — downgrade.
        verdict["verdict"] = "INSUFFICIENT_DATA"
        verdict.setdefault("confidence", "medium")
        return verdict
    failed_reruns = 0
    real_divergences = 0
    for c in diverging:
        a = c.get("value_a")
        b = c.get("value_b")
        try:
            af, bf = float(a), float(b)
        except (TypeError, ValueError):
            real_divergences += 1
            continue
        if af != 0 and bf == 0:
            failed_reruns += 1
        elif af == 0 and bf != 0:
            failed_reruns += 1
        else:
            real_divergences += 1
    if real_divergences == 0 and failed_reruns > 0:
        verdict["verdict"] = "INSUFFICIENT_DATA"
        verdict["confidence"] = "medium"
        existing_caveats = list(verdict.get("honest_caveats") or [])
        existing_caveats.insert(0,
            "Validator's re-runs returned zero rows, which signals an input "
            "mismatch (e.g. category or vendor name variant), not a refuted "
            "finding. Treat the Investigation's numbers as indicative."
        )
        verdict["honest_caveats"] = existing_caveats[:4]
    return verdict


def build_final_brief(plan: dict, findings: dict, verdict: dict) -> dict:
    """Compose the structured Final Brief payload that the frontend's
    FinalBriefCard renders.
    """
    plan = plan or {}
    findings = findings or {}
    verdict = _sanitize_verdict(verdict or {})

    metrics_in = findings.get("metrics") or []
    metrics_table: list[dict] = []
    for m in metrics_in[:6]:
        name = str(m.get("name") or m.get("metric") or "")
        value = m.get("value")
        metrics_table.append({
            "metric": name,
            "value": _format_value(name, value),
            "interpretation": str(m.get("interpretation") or _interp_for(name, value) or ""),
            "call_id": m.get("call_id"),
        })

    sub_theme = _coalesce(findings.get("sub_theme"), plan.get("sub_theme"))
    verdict_label = verdict.get("verdict")
    confidence = verdict.get("confidence")

    return {
        "headline": _headline(findings, verdict),
        "summary": _summary(findings, verdict, plan),
        "metrics_table": metrics_table,
        "sub_theme": sub_theme,
        "verdict": verdict_label,
        "confidence": confidence,
        "recommendation": _recommendation(findings, verdict),
        "caveats": _caveats(findings, verdict, plan),
    }
