#!/usr/bin/env python3
"""Validate the exact D1 upsert SQL with stdlib SQLite; no Firebase/Cloudflare."""
import re
import sqlite3
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "src/qa-d1-budget.js").read_text()
match = re.search(r"export const QA_D1_RESERVE_SQL='([^']+)'", source)
assert match, "SQL must be defined in QA module"
sql = match.group(1)
migration = (ROOT / "migrations/001_qa_budget.sql").read_text()
with tempfile.TemporaryDirectory(prefix="guardian-qa-sql-") as tmp:
    dbfile = Path(tmp) / "qa.sqlite"
    with sqlite3.connect(dbfile) as db:
        db.executescript(migration)
        for used in range(1, 13):
            result = db.execute(sql, ("2026-10-29", 12)).fetchone()
            assert result == (used,), result
        assert db.execute(sql, ("2026-10-29", 12)).fetchone() is None
        assert db.execute(sql, ("2026-10-30", 12)).fetchone() == (1,)
        assert db.execute("SELECT used FROM guardian_qa_daily_budget WHERE day='2026-10-29'").fetchone() == (12,)
    # Separate date: 30 concurrent independent connections, <=12 wins globally.
    def reserve(_):
        with sqlite3.connect(dbfile, timeout=10) as conn:
            conn.execute("PRAGMA busy_timeout=10000")
            return conn.execute(sql, ("2026-10-31", 12)).fetchone()
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(reserve, range(30)))
    accepted = [x[0] for x in results if x is not None]
    assert sorted(accepted) == list(range(1, 13)), accepted
    with sqlite3.connect(dbfile) as db:
        assert db.execute("SELECT used FROM guardian_qa_daily_budget WHERE day='2026-10-31'").fetchone() == (12,)
print("D1 QA SQL PASS: fixed daily bound, UTC date reset, 30 competing connections")
