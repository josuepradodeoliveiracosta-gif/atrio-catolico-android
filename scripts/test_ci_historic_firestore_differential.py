"""Offline, no-network tests for historical Firestore Rules differential analysis."""
import unittest
from scripts.ci_historic_firestore_differential import (
    NOTICE_STAGES, PATCH_NOTICE_FROM, PATCH_NOTICE_TO,
    PATCH_QUOTA_FROM, PATCH_QUOTA_TO, evaluate, instrument_historical_test,
    patch_rules,
)


class DifferentialTests(unittest.TestCase):
    def test_notice_patch_replaces_one_read_without_removing_checks(self):
        fragment = "function rules() {\n" + PATCH_NOTICE_FROM + "\n}"
        patched = patch_rules(fragment, "reply_notice")
        self.assertIn(PATCH_NOTICE_TO, patched)
        self.assertNotIn(PATCH_NOTICE_FROM, patched)
        self.assertEqual(patched.count("getAfter("), 1)
        self.assertIn("function rules()", patched)

    def test_chat_patch_reuses_a_quota_snapshot_not_permission_grants(self):
        rules = PATCH_QUOTA_FROM + "\nallow read, write: if false;\n"
        patched = patch_rules(rules, "chat_general")
        self.assertIn(PATCH_QUOTA_TO, patched)
        self.assertEqual(patched.count("getAfter(chatQuotaPath(uid))"), 1)
        self.assertEqual(patched.count("existsAfter(chatQuotaPath(uid))"), 1)
        self.assertIn("allow read, write: if false;", patched)
        self.assertNotIn("if true;", patched)

    def test_patch_fails_closed_when_anchor_missing_duplicated_or_wrong_case(self):
        with self.assertRaises(ValueError):
            patch_rules("different document", "reply_notice")
        with self.assertRaises(ValueError):
            patch_rules(PATCH_NOTICE_FROM * 2, "reply_notice")
        with self.assertRaises(ValueError):
            patch_rules(PATCH_QUOTA_FROM * 2, "chat_general")
        with self.assertRaises(ValueError):
            patch_rules(PATCH_NOTICE_FROM, "forged_scenario")

    def test_notice_markers_preserve_original_assertions(self):
        sample = "try {\n" + "\n".join(
            line + "async()=>{});" for _, line in NOTICE_STAGES) + "\n}"
        result = instrument_historical_test(sample, "reply_notice")
        for stage, original in NOTICE_STAGES:
            self.assertIn("QA_FORENSIC_STAGE:" + stage, result)
            self.assertIn(original, result)
        self.assertEqual(result.count("QA_FORENSIC_STAGE:"), 4)
        with self.assertRaises(ValueError):
            instrument_historical_test(result, "reply_notice")

    def test_chat_inserts_stage_before_top_level_awaits(self):
        synthetic = ("try {\n  await env.clearFirestore();\n" +
                     "".join(f"  await assertSucceeds(test{i}());\n"
                             for i in range(12)) + "} finally {}\n")
        marked = instrument_historical_test(synthetic, "chat_general")
        self.assertEqual(marked.count("QA_FORENSIC_STAGE:chat_line_"), 13)
        self.assertIn("QA_FORENSIC_STAGE:chat_line_2", marked)
        self.assertIn("await assertSucceeds(test11());", marked)
        with self.assertRaises(ValueError):
            instrument_historical_test("try {\n  await x;\n", "chat_general")

    def test_report_is_sanitized_and_not_root_cause_claim(self):
        log = ("QA_FORENSIC_STAGE:notice_missing_direct_notice\n" +
               "QA_FORENSIC_STAGE:notice_direct_both_positive\n" +
               "PERMISSION_DENIED SECRET=do-not-repeat ghp_example")
        result = evaluate("reply_notice", "baseline", 1, log)
        self.assertEqual(result["last_started_stage"],
                         "notice_direct_both_positive")
        self.assertEqual(result["observed_stage_count"], 2)
        self.assertTrue(result["permission_denied_seen_somewhere"])
        self.assertFalse(result["notice_positive_direct_batch_passed"])
        self.assertFalse(result["raw_log_published"])
        self.assertNotIn("do-not-repeat", repr(result))
        self.assertNotIn("ghp_example", repr(result))
        self.assertEqual(len(result["log_sha256"]), 64)

    def test_chat_markers_preserve_fatal_stage_and_separate_rule_limit(self):
        result = evaluate("chat_general", "counterfactual", 1,
                          "QA_FORENSIC_STAGE:chat_line_104\n"
                          "QA_FORENSIC_STAGE:chat_line_116\n"
                          "PERMISSION_DENIED\nmaximum of 1000 expressions")
        self.assertEqual(result["last_started_stage"], "chat_line_116")
        self.assertTrue(result["expression_limit_seen_somewhere"])
        self.assertTrue(result["permission_denied_seen_somewhere"])
        self.assertEqual(result["test_succeeded"], False)
        self.assertIsNone(result["notice_positive_direct_batch_passed"])

    def test_reject_unknown_or_malformed_observations(self):
        for values in (("unknown", "baseline", 1, ""),
                       ("reply_notice", "unknown", 1, ""),
                       ("reply_notice", "baseline", True, ""),
                       ("reply_notice", "baseline", 0, None)):
            with self.subTest(values=values), self.assertRaises(ValueError):
                evaluate(*values)


if __name__ == "__main__":
    unittest.main()
