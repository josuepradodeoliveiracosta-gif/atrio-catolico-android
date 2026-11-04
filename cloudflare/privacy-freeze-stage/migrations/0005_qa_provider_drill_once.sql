-- 0005: one-shot hosted QA D1 reconciliation drill, no real UIDs or providers.
-- Deliberately no seed rows; only a strictly scoped private Worker can run it.
CREATE TABLE qa_provider_drill_once (
  uid TEXT PRIMARY KEY CHECK(uid='qa-freeze-alice'),
  case_id TEXT NOT NULL UNIQUE CHECK(case_id='fa00bbaa-4a09-4fd2-b399-001122334455'),
  run_id TEXT NOT NULL UNIQUE CHECK(run_id='qa-hosted-provider-20261103-a'),
  state TEXT NOT NULL CHECK(state IN ('started','verified','failed')),
  started_ms INTEGER NOT NULL CHECK(started_ms>0),
  completed_ms INTEGER CHECK(completed_ms IS NULL OR completed_ms>=started_ms)
);
