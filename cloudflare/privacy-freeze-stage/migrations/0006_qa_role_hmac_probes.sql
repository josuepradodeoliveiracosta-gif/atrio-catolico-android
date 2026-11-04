-- Private stage ONLY. Apply to QA fixture D1, never Avatar/Push/Guardian production.
-- A nonce receipt alone is NOT a successful provider readback.
-- This table is a separate one-shot acknowledgement AFTER atomic D1 checks.
CREATE TABLE qa_stage_hmac_role_proofs (
  role TEXT PRIMARY KEY CHECK(role IN ('avatar','guardian','push')),
  uid TEXT NOT NULL CHECK(uid IN ('qa-freeze-alice','qa-freeze-bob')),
  nonce TEXT NOT NULL UNIQUE,
  observed_state TEXT NOT NULL CHECK(observed_state IN ('frozen','active')),
  in_flight INTEGER NOT NULL CHECK(in_flight=0),
  created_ms INTEGER NOT NULL CHECK(created_ms>1000000000000),
  CHECK(
    (role='avatar' AND uid='qa-freeze-alice' AND observed_state='frozen'
      AND nonce='44444444-4444-4444-8444-444444444444') OR
    (role='guardian' AND uid='qa-freeze-bob' AND observed_state='active'
      AND nonce='55555555-5555-4555-8555-555555555555') OR
    (role='push' AND uid='qa-freeze-alice' AND observed_state='frozen'
      AND nonce='66666666-6666-4666-8666-666666666666')
  )
);
