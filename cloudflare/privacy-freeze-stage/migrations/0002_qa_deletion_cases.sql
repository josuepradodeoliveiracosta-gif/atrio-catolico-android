-- Private QA-only D1 migration; apply ONLY to the dedicated
-- atrio-privacy-freeze-stage-fixtures database, never production Avatar/Push.
-- Case state and role attestations cannot contain real Firebase UIDs.
CREATE TABLE qa_deletion_cases (
  uid TEXT PRIMARY KEY CHECK(uid IN ('qa-freeze-alice','qa-freeze-bob')),
  case_id TEXT NOT NULL UNIQUE CHECK(length(case_id)=36),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation=1),
  step INTEGER NOT NULL DEFAULT 0 CHECK(step BETWEEN 0 AND 6),
  opened_ms INTEGER NOT NULL CHECK(opened_ms>0),
  FOREIGN KEY(uid) REFERENCES qa_privileged_accounts(uid)
);
CREATE TABLE qa_deletion_attestations (
  uid TEXT NOT NULL CHECK(uid IN ('qa-freeze-alice','qa-freeze-bob')),
  case_id TEXT NOT NULL,
  step INTEGER NOT NULL CHECK(step BETWEEN 0 AND 5),
  role TEXT NOT NULL CHECK(role IN ('guardian','avatar','push','reconciler')),
  created_ms INTEGER NOT NULL CHECK(created_ms>0),
  PRIMARY KEY(case_id,step),
  FOREIGN KEY(case_id) REFERENCES qa_deletion_cases(case_id)
);
-- There is deliberately no real deletion SQL, Auth or provider credential.
