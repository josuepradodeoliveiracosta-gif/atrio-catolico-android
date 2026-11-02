-- DEDICATED QA D1 ONLY. Do not apply to any existing production database.
-- Reject all real UIDs, tokens and non-QA message identifiers by SQL CHECK.
CREATE TABLE qa_bcast_accounts (
  uid TEXT PRIMARY KEY CHECK (uid IN (
    'qa-batch-00','qa-batch-01','qa-batch-02','qa-batch-03',
    'qa-batch-04','qa-batch-05','qa-batch-06','qa-batch-07','qa-batch-08'
  )),
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active','draining','frozen'))
);
CREATE TABLE qa_bcast_jobs (
  request_id TEXT PRIMARY KEY CHECK (request_id GLOB 'qa-broadcast-*'),
  actor_uid TEXT NOT NULL REFERENCES qa_bcast_accounts(uid),
  revision TEXT NOT NULL CHECK (revision='qa-revision-cloud-v1'),
  manifest_hash TEXT NOT NULL CHECK (manifest_hash='fixture-only-immutable-9-accounts'),
  state TEXT NOT NULL DEFAULT 'ready'
    CHECK (state IN ('ready','processing','halted')),
  lease_generation INTEGER NOT NULL DEFAULT 0
    CHECK (lease_generation BETWEEN 0 AND 999999),
  lease_token TEXT CHECK (lease_token IS NULL OR length(lease_token)=36),
  CHECK ((state='processing' AND lease_token IS NOT NULL) OR
    (state IN ('ready','halted') AND lease_token IS NULL))
);
CREATE TABLE qa_bcast_deliveries (
  request_id TEXT NOT NULL REFERENCES qa_bcast_jobs(request_id),
  recipient_uid TEXT NOT NULL REFERENCES qa_bcast_accounts(uid)
    CHECK (recipient_uid!='qa-batch-00'),
  fake_token TEXT NOT NULL CHECK (fake_token GLOB 'qa-fcm-fixture-*'),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','inflight','acked','ambiguous','reconciled')),
  PRIMARY KEY (request_id,recipient_uid),
  UNIQUE (request_id,fake_token)
);
CREATE INDEX qa_bcast_delivery_state
  ON qa_bcast_deliveries(request_id,state,recipient_uid);
CREATE TABLE qa_bcast_nonces (
  nonce TEXT PRIMARY KEY,
  created_ms INTEGER NOT NULL CHECK(created_ms>0)
);
INSERT INTO qa_bcast_accounts(uid) VALUES
  ('qa-batch-00'),('qa-batch-01'),('qa-batch-02'),('qa-batch-03'),
  ('qa-batch-04'),('qa-batch-05'),('qa-batch-06'),('qa-batch-07'),
  ('qa-batch-08');
