"""Read-only Postgres query runner.

Single connection helper used by the math layer. Read-only by contract:
all queries run inside a transaction with `default_transaction_read_only = on`,
so even an accidental DDL would abort.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()


def _dsn() -> str:
    """Read PG_DSN lazily so the module is import-safe in Lambdas that
    don't talk to Postgres (orchestrator, narrative). The read happens on
    the first query, not at import time.
    """
    dsn = os.environ.get("PG_DSN")
    if not dsn:
        raise RuntimeError("PG_DSN environment variable is not set")
    return dsn


@contextmanager
def _conn() -> Iterator[psycopg2.extensions.connection]:
    conn = psycopg2.connect(_dsn(), connect_timeout=15)
    try:
        with conn.cursor() as cur:
            cur.execute("SET TRANSACTION READ ONLY")
        yield conn
    finally:
        conn.close()


def _fix_mojibake(value: Any) -> Any:
    """Recover UTF-8 bytes that were ingested as Windows-1252.

    Some source CSVs in the dataset contain en-dashes / curly quotes that
    landed in Postgres as the classic `â€"` / `â€™` / `Â` sequences.
    Re-encoding as Windows-1252 (cp1252, a Latin-1 superset that also
    covers the Microsoft 0x80–0x9F range — €, ™, œ, …) and decoding as
    UTF-8 round-trips them back to the intended characters.

    We only attempt this when the telltale bytes appear, and silently
    no-op if the round-trip fails (i.e. the string was already clean
    or is genuinely something else), which makes the call idempotent
    on already-correct text.
    """
    if not isinstance(value, str):
        return value
    if "â€" not in value and "Â" not in value:
        return value
    try:
        return value.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def query(sql: str, params: tuple | dict | None = None) -> list[dict[str, Any]]:
    """Run a SELECT and return rows as dicts. String values are run
    through `_fix_mojibake` to recover ingestion-time UTF-8 corruption.
    """
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or ())
            return [
                {k: _fix_mojibake(v) for k, v in row.items()}
                for row in cur.fetchall()
            ]


def scalar(sql: str, params: tuple | dict | None = None) -> Any:
    """Run a SELECT expected to return one row, one column."""
    rows = query(sql, params)
    if not rows:
        return None
    return next(iter(rows[0].values()))
