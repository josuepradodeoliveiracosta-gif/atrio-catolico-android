-- QA-only hosted Service Binding proof, never apply to Avatar/Push D1.
-- Strict source allowlist, bounded marker count; no real identities or effects.
CREATE TABLE qa_stage_hosted_canaries(
  role TEXT PRIMARY KEY CHECK(role IN ('avatar','guardian','push')),
  run_id TEXT NOT NULL CHECK(run_id='qa-hosted-20261103-a'),
  uid TEXT NOT NULL CHECK(uid IN ('qa-freeze-alice','qa-freeze-bob')),
  result TEXT NOT NULL CHECK(result IN ('admitted','completed')),
  created_ms INTEGER NOT NULL CHECK(created_ms>0)
);
