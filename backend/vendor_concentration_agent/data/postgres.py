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


def query(sql: str, params: tuple | dict | None = None) -> list[dict[str, Any]]:
    """Run a SELECT and return rows as dicts."""
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or ())
            return [dict(r) for r in cur.fetchall()]


def scalar(sql: str, params: tuple | dict | None = None) -> Any:
    """Run a SELECT expected to return one row, one column."""
    rows = query(sql, params)
    if not rows:
        return None
    return next(iter(rows[0].values()))
