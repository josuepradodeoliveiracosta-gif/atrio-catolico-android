-- MIGRATION 0004: QA fixture metadata ONLY. No production provider tables.
-- No user media, no Cloudinary assets, no FCM tokens, no credentials.
-- Two synthetic UIDs enforced at the SQL boundary.
CREATE TABLE qa_provider_fixture_refs(
  uid TEXT NOT NULL CHECK(uid IN ('qa-freeze-alice','qa-freeze-bob')),
  kind TEXT NOT NULL CHECK(kind IN
    ('avatar_d1_pointer','cloudinary_qa_pointer','push_registration_pointer')),
  fixture_ref TEXT NOT NULL CHECK(fixture_ref LIKE 'qa-fixture-%'),
  PRIMARY KEY(uid,kind)
);
CREATE TABLE qa_provider_fixture_holds(
  uid TEXT PRIMARY KEY CHECK(uid IN ('qa-freeze-alice','qa-freeze-bob')),
  hold_kind TEXT NOT NULL CHECK(hold_kind='qa-moderation-review')
);
CREATE TABLE qa_provider_fixture_reconciliations(
  uid TEXT PRIMARY KEY CHECK(uid IN ('qa-freeze-alice','qa-freeze-bob')),
  case_id TEXT NOT NULL UNIQUE CHECK(length(case_id)=36),
  completed_ms INTEGER NOT NULL CHECK(completed_ms>0)
);
-- Deliberately no seed rows. A staged operator must supply its own
-- fully synthetic fixture data before a scoped, offline QA test.
