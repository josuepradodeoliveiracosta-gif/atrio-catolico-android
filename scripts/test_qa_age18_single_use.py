"""Testes reais de transacao SQLite, exclusivamente em diretórios temporarios."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
import sqlite3
import unittest

from scripts.qa_age18_single_use import OfflineChallengeLedger, TTL

UID = "qa-alice"
UID_B = "qa-bob"
SESSION = "synthetic-session-alice-0001"
SESSION_B = "synthetic-session-alice-0002"
NOW = 1_793_000_000
NONCE_A = "A" * 32
NONCE_B = "B" * 32
NONCE_C = "C" * 32
JTI_A = "qa-synthetic-proof-0001"
JTI_B = "qa-synthetic-proof-0002"


class PersistentAge18LabTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.path = Path(self.temp.name) / "single-use-qa.sqlite"
        self.lab = OfflineChallengeLedger(self.path)

    def tearDown(self):
        self.lab.close()
        self.temp.cleanup()

    def issue(self, nonce=NONCE_A, session_id=SESSION, uid=UID, now=NOW):
        return self.lab.issue_fixture(
            uid=uid, session_id=session_id, nonce=nonce, now=now
        )

    def consume(self, nonce=NONCE_A, jti=JTI_A, session_id=SESSION,
                uid=UID, now=NOW + 2, lab=None):
        return (lab or self.lab).consume_verified_fixture(
            uid=uid, session_id=session_id, nonce=nonce, jti=jti, now=now
        )

    def test_single_use_persists_between_separate_connections(self):
        self.assertTrue(self.issue())
        self.assertTrue(self.consume())
        other = OfflineChallengeLedger(self.path)
        try:
            self.assertFalse(self.consume(lab=other))
            self.assertFalse(other.issue_fixture(
                uid=UID_B, session_id=SESSION_B, nonce=NONCE_A, now=NOW + 3
            ))
            self.assertTrue(other.issue_fixture(
                uid=UID_B, session_id=SESSION_B, nonce=NONCE_B, now=NOW + 3
            ))
            self.assertFalse(self.consume(
                lab=other, nonce=NONCE_B, jti=JTI_A,
                uid=UID_B, session_id=SESSION_B
            ))
            self.assertTrue(self.consume(
                lab=other, nonce=NONCE_B, jti=JTI_B,
                uid=UID_B, session_id=SESSION_B, now=NOW + 4
            ))
        finally:
            other.close()

    def test_same_uid_new_session_cannot_reuse_challenge(self):
        self.assertTrue(self.issue())
        self.assertFalse(self.consume(session_id=SESSION_B))
        self.assertFalse(self.consume(uid=UID_B))
        self.assertTrue(self.consume())

    def test_reissue_revokes_old_nonce_even_if_new_nonce_collides(self):
        self.assertTrue(self.issue())
        self.assertTrue(self.issue(nonce=NONCE_B, now=NOW + 1))
        self.assertFalse(self.consume(nonce=NONCE_A))
        self.assertFalse(self.issue(nonce=NONCE_A, now=NOW + 2))
        self.assertFalse(self.consume(nonce=NONCE_B))
        self.assertTrue(self.issue(nonce=NONCE_C, now=NOW + 3))
        self.assertTrue(self.consume(nonce=NONCE_C, now=NOW + 4))

    def test_expiration_and_clock_rollback_fail_closed(self):
        self.assertTrue(self.issue(now=NOW + 10))
        self.assertFalse(self.consume(now=NOW + 9))
        self.assertFalse(self.consume(now=NOW + 10 + TTL))
        self.assertFalse(self.consume(now=NOW + 10 + TTL + 100))

    def test_duplicate_jti_does_not_consume_fresh_challenge(self):
        self.assertTrue(self.issue())
        self.assertTrue(self.consume())
        self.assertTrue(self.issue(nonce=NONCE_B, now=NOW + 5))
        self.assertFalse(self.consume(nonce=NONCE_B, jti=JTI_A, now=NOW + 6))
        self.assertTrue(self.consume(nonce=NONCE_B, jti=JTI_B, now=NOW + 7))

    def test_exactly_one_winner_under_twelve_concurrent_connections(self):
        self.assertTrue(self.issue())
        def attempt(_):
            other = OfflineChallengeLedger(self.path)
            try:
                return self.consume(lab=other)
            finally:
                other.close()
        with ThreadPoolExecutor(max_workers=12) as pool:
            outcomes = list(pool.map(attempt, range(12)))
        self.assertEqual(outcomes.count(True), 1)
        self.assertEqual(outcomes.count(False), 11)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(
                db.execute("SELECT COUNT(*) FROM qa_age18_jtis").fetchone()[0], 1
            )

    def test_invalid_inputs_and_database_unavailable_never_approve(self):
        self.assertFalse(self.issue(uid="qa-alice' OR 1=1--"))
        self.assertFalse(self.issue(now=True))
        self.assertFalse(self.issue(nonce="bad"))
        self.assertFalse(self.consume(jti="too-short"))
        self.assertTrue(self.issue())
        self.lab.close()
        self.assertFalse(self.consume())
        # Evitar double close durante tearDown (idempotente no sqlite3).
        self.assertFalse(self.issue(nonce=NONCE_B))

    def test_no_service_tokens_users_or_chat_access_are_issued(self):
        self.assertTrue(self.issue())
        self.assertIs(self.consume(), True)
        self.assertEqual(
            {name for name in dir(self.lab) if name.startswith("grant_")}, set()
        )


if __name__ == "__main__":
    unittest.main()
