"""Offline contract tests for historic Firestore repro runner. No emulator/network."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_historic_firestore_repro import (
    CASES, PROJECT, REPO, inspect_outcome, safe_environment, execute,
)


class HistoricFirestoreReproTests(unittest.TestCase):
    def test_immutable_historical_sources(self):
        self.assertEqual(set(CASES), {"reply_notice", "chat_general"})
        self.assertEqual(
            CASES["reply_notice"]["sha"],
            "43fac1b50ee12fa0ce1b505bf74ebabd4447e001")
        self.assertEqual(
            CASES["chat_general"]["sha"],
            "422d00ccbd9ef3c7dce11252be045daf656b8e09")
        for settings in CASES.values():
            self.assertGreaterEqual(settings["timeout"], 120)
            self.assertEqual(len(settings["sha"]), 40)
            self.assertIn(settings["config"], (
                "firebase.json", "qa-general.firebase.json"))

    def test_notice_failing_positive_scenario_is_only_a_symptom(self):
        log = (
            "PASS NOTICE-LAB resposta direta sem aviso ao destinatario e rejeitada\n"
            "Firestore: PERMISSION_DENIED: missing or insufficient permissions\n"
        )
        row = inspect_outcome("reply_notice", 1, log)
        self.assertEqual(
            row["classification"],
            "historical_positive_batch_denied_symptom_reproduced")
        self.assertTrue(row["permission_denied_seen"])
        self.assertTrue(row["notice_previous_negative_case_passed"])
        self.assertFalse(row["notice_positive_case_passed"])
        self.assertFalse(row["root_cause_proven"])
        self.assertFalse(row["human_independent_review_completed"])
        self.assertFalse(row["raw_log_stored_or_published"])
        self.assertEqual(row["production_writes"], 0)
        self.assertNotIn("missing or insufficient permissions", str(row))

    def test_successful_test_is_not_fake_reproduction(self):
        result = inspect_outcome(
            "reply_notice", 0,
            "PERMISSION_DENIED\n"
            "PASS NOTICE-LAB resposta direta sem aviso ao destinatario e rejeitada\n"
            "PASS NOTICE-LAB resposta direta com aviso ao autor e destinatario passa")
        self.assertEqual(result["classification"],
                         "historical_failure_not_reproduced")
        self.assertTrue(result["notice_positive_case_passed"])

    def test_general_permission_and_expression_limit_are_separate(self):
        both = inspect_outcome(
            "chat_general", 1,
            "PERMISSION_DENIED maximum of 1000 expressions")
        self.assertEqual(
            both["classification"],
            "permission_denied_and_rule_limit_symptoms_reproduced")
        self.assertTrue(both["max_1000_rule_expressions_seen"])
        self.assertFalse(both["root_cause_proven"])
        only_denied = inspect_outcome(
            "chat_general", 1, "PERMISSION_DENIED")
        self.assertEqual(only_denied["classification"],
                         "permission_denied_symptom_reproduced_without_limit")
        self.assertFalse(only_denied["max_1000_rule_expressions_seen"])
        unrelated = inspect_outcome("chat_general", 1, "npm failed")
        self.assertEqual(unrelated["classification"],
                         "different_failure_or_setup_problem")

    def test_refuse_unsafe_env_and_prod_identity(self):
        expected = {
            "GOOGLE_CLOUD_PROJECT": PROJECT,
            "GITHUB_REPOSITORY": REPO,
            "FIREBASE_TOKEN": "",
            "GOOGLE_APPLICATION_CREDENTIALS": "",
        }
        self.assertEqual(safe_environment(expected)["FIREBASE_PROJECT"], PROJECT)
        for key, value in (
            ("GOOGLE_CLOUD_PROJECT", "real-prod-project"),
            ("GITHUB_REPOSITORY", "attacker/repository"),
            ("FIREBASE_TOKEN", "present"),
            ("GOOGLE_APPLICATION_CREDENTIALS", "/tmp/credentials"),
            ("ATRIO_PUSH_WORKER_URL", "https://example.invalid"),
            ("ATRIO_SIGNING_KEY_PASSWORD", "nonempty"),
            ("GCLOUD_PROJECT", "real-prod-project"),
        ):
            with self.subTest(key=key):
                contaminated = {**expected, key: value}
                with self.assertRaises(ValueError):
                    safe_environment(contaminated)

    def test_frozen_failure_and_source_requirements(self):
        with self.assertRaises(ValueError):
            inspect_outcome("another_case", 1, "PERMISSION_DENIED")
        with self.assertRaises(ValueError):
            inspect_outcome("reply_notice", True, "")
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "historic"
            (root / "tests" / "security").mkdir(parents=True)
            output = root / "cannot-write.json"
            with self.assertRaises(ValueError):
                execute("reply_notice", root, output, env={
                    "GOOGLE_CLOUD_PROJECT": PROJECT})
            with self.assertRaises(ValueError):
                execute("not_an_allowed_case", root, Path(tmp) / "out.json",
                        env={"GOOGLE_CLOUD_PROJECT": PROJECT})


if __name__ == "__main__":
    unittest.main()
