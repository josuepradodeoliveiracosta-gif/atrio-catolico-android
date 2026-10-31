-- ISOLATED QA ONLY. DO NOT apply to avatar D1 or any production database.
-- The CHECK explicitly rejects real customer UIDs, even with a privileged caller.
CREATE TABLE qa_privileged_accounts (
  uid TEXT PRIMARY KEY CHECK (uid IN ('qa-freeze-alice', 'qa-freeze-bob')),
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'draining', 'frozen'))
);
CREATE TABLE qa_privileged_operations (
  operation_id TEXT NOT NULL,
  uid TEXT NOT NULL CHECK (uid IN ('qa-freeze-alice','qa-freeze-bob')),
  kind TEXT NOT NULL CHECK (kind IN (
    'avatar_upload','avatar_promote','avatar_remove','avatar_moderation',
    'guardian_content_write','guardian_review_write','push_thread_notice',
    'push_fcm_send','push_cleanup_device'
  )),
  PRIMARY KEY (operation_id,uid),
  FOREIGN KEY (uid) REFERENCES qa_privileged_accounts(uid)
);
CREATE INDEX qa_privileged_operations_by_uid ON qa_privileged_operations(uid);
INSERT INTO qa_privileged_accounts(uid) VALUES ('qa-freeze-alice'),('qa-freeze-bob');
