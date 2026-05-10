"""SQLite-backed job + notification store. Replaces the AWS DynamoDB
`vendor-agent-jobs` and `vendor-agent-notifications` tables.

Schema mirrors the DynamoDB shape so server.py response payloads stay
identical from the frontend's perspective:

  jobs(job_id PK, status, message, context, route, error, result, ...)
    - events: JSON list (append-only via list_append-equivalent)
    - audit:  JSON dict keyed by call_id
    - active_agent: JSON list or null
    - created_at, updated_at: ISO timestamps for ordering / TTL

  notifications(notification_id PK, source_job_id, created_at, ...)
    - hits: JSON list of high-HHI findings

The store is process-local. For Modal deployment we keep the SQLite
file on a Modal Volume so it survives function restarts; for local dev
it's just a file under `backend/`.
"""

from __future__ import annotations

import json
import logging
import math
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get("JOBSTORE_DB", "vendor_agent.db")

# 24 hour job TTL + 7 day notification TTL — same as the DynamoDB
# `ttl` field semantics. We sweep on read instead of on write.
_JOB_TTL_SECONDS = 24 * 3600
_NOTIFICATION_TTL_SECONDS = 7 * 24 * 3600


# ── JSON helper: reject NaN/Inf, no Decimal coercion needed ──────────────────

def _clean(value: Any) -> Any:
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return value


def _dumps(value: Any) -> str:
    return json.dumps(_clean(value), ensure_ascii=False)


def _loads(s: str | None, default: Any) -> Any:
    if not s:
        return default
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return default


# ── Connection ────────────────────────────────────────────────────────────────

_conn_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    with _conn_lock:
        if _conn is not None:
            return _conn
        c = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        _init_schema(c)
        _conn = c
        return c


def _init_schema(c: sqlite3.Connection) -> None:
    c.executescript("""
        CREATE TABLE IF NOT EXISTS jobs (
            job_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            message TEXT,
            context TEXT,
            events TEXT NOT NULL DEFAULT '[]',
            audit TEXT NOT NULL DEFAULT '{}',
            active_agent TEXT,
            route TEXT,
            result TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

        CREATE TABLE IF NOT EXISTS notifications (
            notification_id TEXT PRIMARY KEY,
            source_job_id TEXT,
            created_at TEXT NOT NULL,
            question TEXT,
            headline TEXT,
            summary TEXT,
            verdict TEXT,
            confidence TEXT,
            sub_theme TEXT,
            entity TEXT,
            category TEXT,
            recommendation TEXT,
            metrics_table TEXT NOT NULL DEFAULT '[]',
            caveats TEXT NOT NULL DEFAULT '[]',
            cross_checks TEXT NOT NULL DEFAULT '[]',
            hits TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_created_at
            ON notifications(created_at);

        CREATE TABLE IF NOT EXISTS dashboard_cache (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL,
            expires_at  REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dashboard_cache_expires
            ON dashboard_cache(expires_at);
    """)
    # Idempotent migrations for DBs created before each column existed.
    cols = {r["name"] for r in c.execute("PRAGMA table_info(notifications)").fetchall()}
    for name, ddl in [
        ("entity", "ALTER TABLE notifications ADD COLUMN entity TEXT"),
        ("category", "ALTER TABLE notifications ADD COLUMN category TEXT"),
        ("recommendation", "ALTER TABLE notifications ADD COLUMN recommendation TEXT"),
        ("metrics_table", "ALTER TABLE notifications ADD COLUMN metrics_table TEXT NOT NULL DEFAULT '[]'"),
        ("caveats", "ALTER TABLE notifications ADD COLUMN caveats TEXT NOT NULL DEFAULT '[]'"),
        ("cross_checks", "ALTER TABLE notifications ADD COLUMN cross_checks TEXT NOT NULL DEFAULT '[]'"),
    ]:
        if name not in cols:
            c.execute(ddl)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Sink (matches the JobSink protocol in orchestration.py) ──────────────────

class SqliteJobSink:
    """Synchronous methods called from the orchestrator. Each call is one
    SQLite transaction (autocommit via `isolation_level=None`).
    """

    def create_job(self, job_id: str, message: str, context: str = "") -> None:
        c = _get_conn()
        now = _now()
        c.execute(
            "INSERT OR REPLACE INTO jobs (job_id, status, message, context, "
            "events, audit, active_agent, created_at, updated_at) "
            "VALUES (?, 'pending', ?, ?, '[]', '{}', NULL, ?, ?)",
            (job_id, message, context, now, now),
        )

    def set_status(self, job_id: str, status: str, **extra: Any) -> None:
        c = _get_conn()
        cols = ["status = ?", "updated_at = ?"]
        vals: list[Any] = [status, _now()]
        for k, v in extra.items():
            if k in ("active_agent", "route", "result"):
                cols.append(f"{k} = ?")
                vals.append(_dumps(v) if v is not None else None)
            elif k == "error":
                cols.append("error = ?")
                vals.append(str(v) if v is not None else None)
            elif k == "events" and isinstance(v, list):
                cols.append("events = ?")
                vals.append(_dumps(v))
            elif k == "audit" and isinstance(v, dict):
                cols.append("audit = ?")
                vals.append(_dumps(v))
        vals.append(job_id)
        c.execute(f"UPDATE jobs SET {', '.join(cols)} WHERE job_id = ?", vals)

    def append_events(self, job_id: str, events: list[dict]) -> None:
        if not events:
            return
        c = _get_conn()
        row = c.execute("SELECT events FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        if not row:
            return
        existing = _loads(row["events"], [])
        existing.extend(_clean(e) for e in events)
        c.execute(
            "UPDATE jobs SET events = ?, updated_at = ? WHERE job_id = ?",
            (_dumps(existing), _now(), job_id),
        )

    def merge_audit(self, job_id: str, audit: dict[str, dict]) -> None:
        if not audit:
            return
        c = _get_conn()
        row = c.execute("SELECT audit FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        if not row:
            return
        existing = _loads(row["audit"], {})
        for call_id, blob in audit.items():
            slim = dict(blob)
            if isinstance(slim.get("source_rows"), list):
                slim["source_rows"] = slim["source_rows"][:20]
            existing[call_id] = _clean(slim)
        c.execute(
            "UPDATE jobs SET audit = ?, updated_at = ? WHERE job_id = ?",
            (_dumps(existing), _now(), job_id),
        )

    def set_active(self, job_id: str, agents: list[str] | None) -> None:
        c = _get_conn()
        c.execute(
            "UPDATE jobs SET active_agent = ?, updated_at = ? WHERE job_id = ?",
            (_dumps(agents) if agents else None, _now(), job_id),
        )

    def save_notification(self, notification: dict[str, Any]) -> None:
        c = _get_conn()
        c.execute(
            "INSERT OR REPLACE INTO notifications "
            "(notification_id, source_job_id, created_at, question, headline, "
            " summary, verdict, confidence, sub_theme, entity, category, "
            " recommendation, metrics_table, caveats, cross_checks, hits) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                notification["notification_id"],
                notification.get("source_job_id"),
                notification.get("created_at") or _now(),
                notification.get("question"),
                notification.get("headline"),
                notification.get("summary"),
                notification.get("verdict"),
                notification.get("confidence"),
                notification.get("sub_theme"),
                notification.get("entity"),
                notification.get("category"),
                notification.get("recommendation"),
                _dumps(notification.get("metrics_table") or []),
                _dumps(notification.get("caveats") or []),
                _dumps(notification.get("cross_checks") or []),
                _dumps(notification.get("hits") or []),
            ),
        )


# ── Read helpers (used by server.py routes) ──────────────────────────────────

def _row_to_job(row: sqlite3.Row, *, include_audit: bool = False) -> dict[str, Any]:
    out = {
        "job_id": row["job_id"],
        "status": row["status"],
        "events": _loads(row["events"], []),
        "active_agent": _loads(row["active_agent"], None),
        "result": _loads(row["result"], None),
        "route": _loads(row["route"], None),
        "error": row["error"],
    }
    if include_audit:
        out["audit"] = _loads(row["audit"], {})
    return out


def get_job(job_id: str) -> dict[str, Any] | None:
    row = _get_conn().execute(
        "SELECT * FROM jobs WHERE job_id = ?", (job_id,)
    ).fetchone()
    return _row_to_job(row) if row else None


def get_audit_blob(job_id: str, call_id: str) -> dict[str, Any] | None:
    row = _get_conn().execute(
        "SELECT audit FROM jobs WHERE job_id = ?", (job_id,)
    ).fetchone()
    if not row:
        return None
    audit = _loads(row["audit"], {})
    return audit.get(call_id)


def list_notifications(limit: int = 25) -> dict[str, Any]:
    cutoff = datetime.fromtimestamp(time.time() - _NOTIFICATION_TTL_SECONDS, timezone.utc).isoformat()
    rows = _get_conn().execute(
        "SELECT * FROM notifications WHERE created_at > ? "
        "ORDER BY created_at DESC LIMIT ?",
        (cutoff, max(1, min(limit, 100))),
    ).fetchall()
    items = [
        {
            "notification_id": r["notification_id"],
            "source_job_id": r["source_job_id"],
            "created_at": r["created_at"],
            "question": r["question"],
            "headline": r["headline"],
            "summary": r["summary"],
            "verdict": r["verdict"],
            "confidence": r["confidence"],
            "sub_theme": r["sub_theme"],
            "entity": r["entity"],
            "category": r["category"],
            "recommendation": r["recommendation"],
            "metrics_table": _loads(r["metrics_table"], []),
            "caveats": _loads(r["caveats"], []),
            "cross_checks": _loads(r["cross_checks"], []),
            "hits": _loads(r["hits"], []),
        }
        for r in rows
    ]
    return {"items": items, "count": len(items)}


def sweep_expired_jobs() -> int:
    """Best-effort TTL sweep for old jobs. Called opportunistically
    from server.py route handlers; not a separate cron.
    """
    cutoff = datetime.fromtimestamp(time.time() - _JOB_TTL_SECONDS, timezone.utc).isoformat()
    cur = _get_conn().execute("DELETE FROM jobs WHERE updated_at < ?", (cutoff,))
    return cur.rowcount or 0


# ── Dashboard response cache (L2, persistent across container restarts) ──────
#
# The dashboards layer keeps an in-process dict for sub-microsecond hits.
# This SQLite-backed layer survives restarts and rolling deploys, so the
# first user after a deploy gets warm responses instead of paying the
# full Postgres CTE latency. The dashboards decorator uses both layers.

def dashboard_cache_get(key: str) -> Any | None:
    """Return the JSON-decoded cached value for `key` if its expiry is
    still in the future; otherwise None. None is also returned if the
    stored payload fails to JSON-decode (treated as a miss).
    """
    row = _get_conn().execute(
        "SELECT value FROM dashboard_cache WHERE key = ? AND expires_at > ?",
        (key, time.time()),
    ).fetchone()
    return _loads(row["value"], None) if row else None


def dashboard_cache_set(key: str, value: Any, ttl_seconds: float) -> None:
    """Upsert (key, JSON-encoded value, now+ttl). Idempotent — last
    writer wins, which is fine since two containers computing the same
    response will produce identical payloads.
    """
    _get_conn().execute(
        "INSERT OR REPLACE INTO dashboard_cache (key, value, expires_at) "
        "VALUES (?, ?, ?)",
        (key, _dumps(value), time.time() + float(ttl_seconds)),
    )


def dashboard_cache_sweep() -> int:
    """Delete expired dashboard_cache rows. Called opportunistically."""
    cur = _get_conn().execute(
        "DELETE FROM dashboard_cache WHERE expires_at <= ?", (time.time(),)
    )
    return cur.rowcount or 0
