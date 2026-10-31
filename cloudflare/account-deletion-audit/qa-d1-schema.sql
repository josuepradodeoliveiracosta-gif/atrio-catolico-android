-- ONLY FOR ISOLATED QA. Never apply to the avatar D1 database or production.
-- This schema has NO foreign keys to user records and cannot delete accounts.
CREATE TABLE IF NOT EXISTS qa_privacy_runs (
  fixture TEXT PRIMARY KEY CHECK(fixture = 'qa-delete-alice'),
  lease_token TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation >= 1),
  lease_expires_at INTEGER NOT NULL CHECK(lease_expires_at >= 0),
  last_step INTEGER NOT NULL DEFAULT 0 CHECK(last_step BETWEEN 0 AND 8),
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
);

CREATE INDEX IF NOT EXISTS idx_qa_privacy_runs_expiry
ON qa_privacy_runs(lease_expires_at);
