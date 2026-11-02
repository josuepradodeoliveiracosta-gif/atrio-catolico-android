-- QA-ONLY SQLite fixture. Never apply this schema to a Cloudflare D1,
-- Firebase, Cloudinary or other production database.
-- Each accepted UID is explicitly enumerated; real user IDs are rejected.
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
  revision TEXT NOT NULL,
  manifest_hash TEXT NOT NULL CHECK (length(manifest_hash)=64),
  state TEXT NOT NULL CHECK (state IN ('ready','processing','halted'))
);
CREATE TABLE qa_bcast_deliveries (
  request_id TEXT NOT NULL REFERENCES qa_bcast_jobs(request_id),
  recipient_uid TEXT NOT NULL REFERENCES qa_bcast_accounts(uid),
  fake_token TEXT NOT NULL CHECK (fake_token GLOB 'qa-fcm-*'),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','inflight','acked','ambiguous','reconciled')),
  PRIMARY KEY(request_id,recipient_uid),
  UNIQUE(request_id,fake_token)
);
CREATE INDEX qa_bcast_pending_by_request
  ON qa_bcast_deliveries(request_id,state,recipient_uid);
CREATE INDEX qa_bcast_pending_by_recipient
  ON qa_bcast_deliveries(recipient_uid,state);
INSERT INTO qa_bcast_accounts(uid) VALUES
 ('qa-batch-00'),('qa-batch-01'),('qa-batch-02'),('qa-batch-03'),
 ('qa-batch-04'),('qa-batch-05'),('qa-batch-06'),('qa-batch-07'),
 ('qa-batch-08');

-- Durable replay defense for the QA HMAC Service Binding emulator.
-- Nonces are never shared with a real Cloudflare D1 binding.
CREATE TABLE qa_bcast_nonces (
  nonce TEXT PRIMARY KEY,
  created_ms INTEGER NOT NULL CHECK (created_ms>0)
);
