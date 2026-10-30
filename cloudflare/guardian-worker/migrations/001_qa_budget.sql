-- PRIVATE QA DATABASE ONLY. Do not execute against the official Firebase or app DB.
-- Exactly one row per UTC date; the SQL reservation is one atomic statement.
CREATE TABLE IF NOT EXISTS guardian_qa_daily_budget (
  day TEXT PRIMARY KEY NOT NULL CHECK (length(day) = 10),
  used INTEGER NOT NULL CHECK (used BETWEEN 1 AND 12)
) WITHOUT ROWID;
