"""Offline checks for demo-only prerequisite probes (no API calls, no secrets)."""
import json
import unittest

from scripts.ci_historic_firestore_fixture import (
    NOTICE_ANCHOR, CHAT_ANCHOR, CHAT_GROUP_DECLARATION, NOTICE_KEYS, CHAT_KEYS,
    classify_fixture, instrument,
)


class FixtureProbeTests(unittest.TestCase):
    def test_notice_source_preserves_positive_and_negative_checks(self):
        source = (
            "const env = {};\ntry {\n"
            "  await assertFails(denied());\n"
            + NOTICE_ANCHOR + "\n"
            "    await assertSucceeds(b.commit());\n"
            "  });\n} finally {await env.cleanup();}\n"
        )
        result = instrument(source, "reply_notice")
        self.assertEqual(result.count(NOTICE_ANCHOR), 1)
        self.assertIn("await assertFails(denied());", result)
        self.assertIn("await assertSucceeds(b.commit());", result)
        self.assertEqual(result.count("await qaSyntheticFixtureProbe();"), 1)
        self.assertIn("env.withSecurityRulesDisabled", result)
        self.assertIn("QA_FOR_FIXTURE:", result)
        self.assertNotIn("firebase deploy", result)

    def test_chat_anchor_target_is_positive_invite_not_negative(self):
        source = (
            "try {\n" + CHAT_GROUP_DECLARATION + "\n"
            " await assertFails(newInvite());\n"
            + CHAT_ANCHOR + "\n}finally{}\n"
        )
        result = instrument(source, "chat_general")
        self.assertEqual(result.count("await assertFails(newInvite());"), 1)
        self.assertEqual(result.count(CHAT_ANCHOR), 1)
        self.assertLess(result.index("await assertFails(newInvite());"),
                        result.index("await qaSyntheticFixtureProbe(inviteGroup);"))
        self.assertLess(result.index("await qaSyntheticFixtureProbe(inviteGroup);"),
                        result.index(CHAT_ANCHOR))
        self.assertIn("async function qaSyntheticFixtureProbe(inviteGroup)", result)
        self.assertEqual(result.count(CHAT_GROUP_DECLARATION), 1)
        self.assertNotIn("await qaSyntheticFixtureProbe();", result)
        self.assertIn("recipient_has_not_blocked_inviter", result)

    def test_reject_modified_source_and_duplicate_instrumentation(self):
        samples = [
            ("try {\n await wrongInvite();\n", "chat_general"),
            ("try {\n await wrongNotice();\n", "reply_notice"),
            ("try {\n"+ CHAT_ANCHOR+"\n"+CHAT_ANCHOR+"\n", "chat_general"),
            ("QA_FOR_FIXTURE:unexpected\ntry {\n"+CHAT_ANCHOR, "chat_general"),
            ("try {\n"+CHAT_ANCHOR, "chat_general"),
            ("try {\n"+CHAT_ANCHOR+"\n"+CHAT_GROUP_DECLARATION, "chat_general"),
        ]
        for source, case in samples:
            with self.subTest(case=case), self.assertRaises(ValueError):
                instrument(source, case)
        with self.assertRaises(ValueError):
            instrument("try {\n"+CHAT_ANCHOR, "new_case")

    def test_emulator_callback_result_is_assigned_inside_callback(self):
        from scripts.ci_historic_firestore_fixture import NOTICE_SENSOR, CHAT_SENSOR
        for source in (NOTICE_SENSOR, CHAT_SENSOR):
            with self.subTest(sensor=source[:35]):
                self.assertIn("await env.withSecurityRulesDisabled(async ctx => {", source)
                self.assertIn("let row = {probe_unavailable:true};", source)
                self.assertIn("row = {", source)
                self.assertNotIn("row = await env.withSecurityRulesDisabled", source)
                self.assertIn("QA_FOR_FIXTURE:", source)

    def test_all_true_is_only_prerequisite_validation(self):
        for case, keys in (("reply_notice",NOTICE_KEYS),("chat_general",CHAT_KEYS)):
            log="QA_FOR_FIXTURE:"+json.dumps({k:True for k in keys})+"\n"
            result=classify_fixture(log,case)
            self.assertEqual(result["status"],"all_expected_fixtures_present")
            self.assertEqual(result["expected_flag_count"],len(keys))
            self.assertEqual(result["unexpected_flags_count"],0)
            self.assertFalse(result["root_cause_proven"])

    def test_one_flag_false_is_reported_without_revealing_values(self):
        vals={k:True for k in CHAT_KEYS}
        vals["chat_status_accepted"]=False
        log="QA_FOR_FIXTURE:"+json.dumps(vals)+"\nSECRET=ghp_example\n"
        got=classify_fixture(log,"chat_general")
        self.assertEqual(got["status"],"fixture_mismatch_observed")
        self.assertFalse(got["booleans"]["chat_status_accepted"])
        self.assertEqual(got["unexpected_flags_count"],1)
        self.assertNotIn("ghp_example",repr(got))

    def test_safe_failure_category_identifies_read_without_leaking_error(self):
        from scripts.ci_historic_firestore_fixture import CHAT_SENSOR
        self.assertIn("stage = 'evaluate_flags'", CHAT_SENSOR)
        self.assertIn("await read('read_contact', room)", CHAT_SENSOR)
        self.assertIn("stage = step + '_reference'", CHAT_SENSOR)
        self.assertIn("stage = step + '_fetch'", CHAT_SENSOR)
        self.assertIn("stage = step + '_complete'", CHAT_SENSOR)
        self.assertIn("await read('read_inverse_block'", CHAT_SENSOR)
        sample = {"probe_unavailable": True, "stage": "read_contact_fetch",
                  "category": "ReferenceError"}
        result = classify_fixture(
            "QA_FOR_FIXTURE:" + json.dumps(sample), "chat_general")
        self.assertEqual(result["status"], "probe_unavailable")
        self.assertEqual(result["stage"], "read_contact_fetch")
        self.assertEqual(result["failure_category"], "ReferenceError")
        self.assertEqual(result["booleans"], {})
        for phase in ("reference", "fetch", "complete"):
            probe = {**sample, "stage": "read_contact_" + phase}
            self.assertEqual(classify_fixture(
                "QA_FOR_FIXTURE:" + json.dumps(probe), "chat_general")["status"],
                "probe_unavailable")
        malicious = {**sample, "stage": "SECRET=do-not-expose"}
        rejected = classify_fixture(
            "QA_FOR_FIXTURE:" + json.dumps(malicious), "chat_general")
        self.assertNotIn("do-not-expose", repr(rejected))
        self.assertEqual(rejected["booleans"], {})

    def test_missing_multiple_bad_or_unavailable_are_fail_closed(self):
        valid={k:True for k in NOTICE_KEYS}
        for log in (
            "", "QA_FOR_FIXTURE:{broken", "QA_FOR_FIXTURE:{}",
            "QA_FOR_FIXTURE:"+json.dumps({**valid,"token":"secret"}),
            "QA_FOR_FIXTURE:"+json.dumps({**valid,NOTICE_KEYS[0]:1}),
            "QA_FOR_FIXTURE:"+json.dumps(valid)+"\nQA_FOR_FIXTURE:"+json.dumps(valid),
            "QA_FOR_FIXTURE:"+json.dumps({"probe_unavailable":True}),
        ):
            with self.subTest(log=log[:20]):
                got=classify_fixture(log,"reply_notice")
                self.assertNotEqual(got["status"],"all_expected_fixtures_present")
                self.assertEqual(got["booleans"],{})

    def test_refuse_oversized_logs_and_unknown_scenarios(self):
        with self.assertRaises(ValueError):
            classify_fixture("x"*12000001,"reply_notice")
        with self.assertRaises(ValueError):
            classify_fixture("","wrong_case")


if __name__=="__main__":
    unittest.main()
