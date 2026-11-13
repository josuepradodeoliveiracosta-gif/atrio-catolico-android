"""Offline safety contracts for the guard-preserving Firebase Emulator probe."""
import unittest

from scripts.ci_historic_firestore_contact_debug import (
    CONTACT_CALL, DEBUG_CALL, CREATE_START, CREATE_END,
    CANARY, CANARY_CREATE_START, HELPER_ORIGINAL, HELPER_INSTRUMENTED,
    classify_debug_log, instrument_contact_debug,
)


def synthetic_rules():
    return (
        "rules_version = '2';\n"
        "service cloud.firestore { match /databases/{database}/documents {\n"
        + HELPER_ORIGINAL + "\n"
        "match /chat_groups/{groupId}/atrioGroupInvites/{inviteeUid} {\n"
        + CREATE_START + "\n"
        "          && qaChatAge16Eligible(inviteeUid)\n"
        "          && atrioGroupAdmin(groupId)\n"
        "          && request.resource.data.status == 'pending'\n"
        "          && !exists(/databases/$(database)/documents/users/$(inviteeUid)/blockedMembers/$(request.auth.uid))\n"
        + CONTACT_CALL + "\n"
        + CREATE_END + "\n"
        "          && atrioGroupAcceptedContact(\n"
        "             request.auth.uid,inviteeUid,resource.data.contactChatId);\n"
        "}}}\n"
    )


class ContactDebugSafeguards(unittest.TestCase):
    def test_wraps_only_invite_create_without_changing_its_value(self):
        rules = synthetic_rules()
        result = instrument_contact_debug(rules)
        self.assertEqual(result, rules.replace(CONTACT_CALL, DEBUG_CALL, 1)
                         .replace(CREATE_START, CANARY_CREATE_START, 1)
                         .replace(HELPER_ORIGINAL, HELPER_INSTRUMENTED, 1))
        self.assertIn("debug(validId(contactChatId))", result)
        self.assertIn("debug(get(/databases/", result)
        self.assertIn("debug(exists(/databases/", result)
        self.assertEqual(result.count("debug(exists("), 1)
        self.assertIn("QA_ATRIO_CONTACT_EXISTS", result)
        self.assertIn(".data.status == 'accepted');", result)
        self.assertEqual(result.count(CANARY_CREATE_START), 1)
        self.assertIn(CANARY, result)
        self.assertEqual(result.count(DEBUG_CALL), 1)
        self.assertEqual(result.count(CONTACT_CALL), 0)
        self.assertIn("qaChatAge16Eligible(inviteeUid)", result)
        self.assertIn("atrioGroupAdmin(groupId)", result)
        self.assertIn("blockedMembers", result)
        self.assertIn("request.resource.data.status == 'pending'", result)
        self.assertIn(CREATE_END, result)
        self.assertIn("resource.data.contactChatId);", result)
        self.assertNotIn("&& true; // QA-ONLY", result)
        self.assertNotIn("allow read, write: if true", result)

    def test_reject_missing_duplicate_or_preinstrumented_predicates(self):
        original = synthetic_rules()
        for value in (
            original.replace(CONTACT_CALL, ""),
            original.replace(CONTACT_CALL, CONTACT_CALL + CONTACT_CALL),
            original.replace(CREATE_START, "allow create: if true"),
            original.replace("qaChatAge16Eligible(inviteeUid)", "true"),
            original.replace("atrioGroupAdmin(groupId)", "true"),
            original.replace("blockedMembers/", "notBlocked/"),
            original + "debug(true)",
            original.replace(CREATE_END, "allow update: if true"),
            original.replace(HELPER_ORIGINAL, "function other() {return true;}"),
        ):
            with self.subTest(change=value[:40]), self.assertRaises(ValueError):
                instrument_contact_debug(value)
        with self.assertRaises(ValueError):
            instrument_contact_debug(synthetic_rules() + CREATE_START)

    def test_fail_closed_unknown_inputs(self):
        for value in (None, 5, "", "x" * 200001):
            with self.subTest(t=type(value).__name__), self.assertRaises(ValueError):
                instrument_contact_debug(value)

    def test_sanitize_only_boolean_debug_values(self):
        sample = b"string_value: synthetic-private\nbool_value: true\n"
        result = classify_debug_log(sample)
        self.assertEqual(result["status"], "only_true_observed")
        self.assertEqual(result["true_count"], 1)
        self.assertEqual(result["false_count"], 0)
        self.assertTrue(result["single_evaluation"])
        self.assertNotIn("synthetic-private", repr(result))
        self.assertEqual(classify_debug_log(b"bool_value: false\n")["status"],
                         "only_false_observed")
        mixed = classify_debug_log(b"bool_value: true\nbool_value: false\n")
        self.assertEqual(mixed["status"], "mixed_multiple_evaluations")
        self.assertFalse(mixed["single_evaluation"])

    def test_distinguishes_missing_document_from_missing_status_value(self):
        # Synthetic local debug excerpts only. No document IDs or values exported.
        trace = (
            b'string_value: "QA_ATRIO_CONTACT_EXISTS"\n'
            b'bool_value: false\n'
        )
        states = classify_debug_log(trace)['guard_subexpressions']
        self.assertEqual(states['chat_exists']['value'], 'false')
        self.assertEqual(states['chat_accepted']['value'], 'not_observed')
        self.assertFalse(states['chat_accepted']['marker_seen'])

    def test_preserves_original_contact_status_requirement(self):
        self.assertIn(".data.status == 'accepted'", HELPER_ORIGINAL)
        self.assertIn(".data.status == 'accepted'", HELPER_INSTRUMENTED)
        self.assertIn("debug(exists(/databases/", HELPER_INSTRUMENTED)
        self.assertIn("debug(get(/databases/", HELPER_INSTRUMENTED)
        self.assertNotIn("|| true", HELPER_INSTRUMENTED)
        self.assertNotIn("allow create: if true", HELPER_INSTRUMENTED)

    def test_no_log_or_ambiguous_log_is_never_a_causal_claim(self):
        self.assertEqual(classify_debug_log(None)["status"], "log_unavailable")
        self.assertEqual(classify_debug_log(b"")[ "status"],
                         "canary_and_boolean_absent")
        self.assertEqual(classify_debug_log(b"ERROR SECRET\n")["true_count"], 0)
        canary = ('string_value: "' + CANARY + '"\n').encode('utf-8')
        self.assertEqual(classify_debug_log(canary)["status"],
                         "canary_seen_boolean_absent")
        self.assertTrue(classify_debug_log(canary)["canary_marker_seen"])
        self.assertEqual(classify_debug_log(canary+b'[time] bool_value: false\n')["status"],
                         "only_false_observed")
        self.assertTrue(classify_debug_log(canary+b'[time] bool_value: false\n')["bool_keyword_seen"])
        segmented = (
            canary + b'string_value: "QA_ATRIO_CONTACT_ID"\n'
            b'bool_value: true\n'
            b'string_value: "QA_ATRIO_CONTACT_PAIR"\n'
            b'bool_value: true\n'
            b'string_value: "QA_ATRIO_CONTACT_EXISTS"\n'
            b'bool_value: true\n'
            b'string_value: "QA_ATRIO_CONTACT_STATUS"\n'
        )
        stage = classify_debug_log(segmented)['guard_subexpressions']
        self.assertEqual(stage['valid_id']['value'], 'true')
        self.assertEqual(stage['canonical_pair']['value'], 'true')
        self.assertEqual(stage['chat_exists']['value'], 'true')
        self.assertEqual(stage['chat_accepted']['value'], 'not_observed')
        self.assertTrue(stage['chat_exists']['marker_seen'])
        self.assertTrue(stage['chat_accepted']['marker_seen'])
        self.assertNotIn('SECRET', repr(stage))
        self.assertEqual(classify_debug_log("SECRET")["status"],
                         "log_unavailable_or_oversized")
        rows = classify_debug_log(b"bool_value: true\n" * 101)
        self.assertEqual(rows["status"], "too_many_debug_values")
        self.assertNotIn("SECRET", repr(rows))
        self.assertTrue(classify_debug_log(b"bool_value: true\n")[
            "guard_value_is_not_independent_causal_proof"])


if __name__ == "__main__":
    unittest.main()
