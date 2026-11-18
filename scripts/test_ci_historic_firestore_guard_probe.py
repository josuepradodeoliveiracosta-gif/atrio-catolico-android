"""Offline fail-closed tests for deliberately UNSAFE emulator-only guard probes."""
import unittest

from scripts.ci_historic_firestore_guard_probe import (
    one_guard_probe, NOTICE_START, NOTICE_END, NOTICE_GUARD,
    CHAT_START, CHAT_END, CHAT_GUARD, LABELS,
)


NOTICE = (
    "unrelated deny condition\n"
    + NOTICE_START
    + "        let currentPath = /databases/$(database)/documents/posts/p/replies/r;\n"
    + "        return validId(targetId)\n"
    + "          && getAfter(currentPath).data.replyToId == targetId\n"
    + NOTICE_GUARD
    + "          && get(/databases/$(database)/documents/posts/p/replies/t).data.uid == recipientUid;\n"
    + "      }\n"
    + NOTICE_END
    + "        return false;\n"
)
CHAT = (
    "unrelated deny condition\n"
    + CHAT_START
    + "\n          && qaChatAge16Eligible(inviteeUid)"
    + "\n          && atrioGroupAdmin(groupId)"
    + "\n          && request.resource.data.status == 'pending'"
    + "\n          && request.resource.data.createdAt == request.time"
    + "\n          && !exists(/databases/$(database)/documents/users/$(inviteeUid)/blockedMembers/$(request.auth.uid))"
    + "\n" + CHAT_GUARD + "\n"
    + CHAT_END + "\n        && false;\n"
)


class GuardProbeTests(unittest.TestCase):
    def test_notice_removes_only_one_bounded_predicate(self):
        altered = one_guard_probe(NOTICE, "reply_notice")
        self.assertEqual(altered, NOTICE.replace(NOTICE_GUARD, "", 1))
        self.assertIn("unrelated deny condition", altered)
        self.assertIn("getAfter(currentPath)", altered)
        self.assertIn(NOTICE_END, altered)
        self.assertNotIn(NOTICE_GUARD, altered)

    def test_invite_patch_does_not_change_original_negative_guards(self):
        altered = one_guard_probe(CHAT, "chat_general")
        self.assertEqual(altered, CHAT.replace(
            CHAT_GUARD, "          && true; // QA-ONLY OMIT CONTACT GUARD; NEVER DEPLOY", 1))
        for item in (
            "qaChatAge16Eligible(inviteeUid)", "atrioGroupAdmin(groupId)",
            "blockedMembers", "request.resource.data.status == 'pending'",
            CHAT_END, "unrelated deny condition",
        ):
            self.assertIn(item, altered)
        self.assertNotIn(CHAT_GUARD, altered)
        self.assertIn("NEVER DEPLOY", altered)

    def test_fail_closed_on_missing_duplicated_or_changed_predicates(self):
        for original,case,guard,start in (
            (NOTICE,"reply_notice",NOTICE_GUARD,NOTICE_START),
            (CHAT,"chat_general",CHAT_GUARD,CHAT_START),
        ):
            for bad in (
                original.replace(guard, "", 1),
                original.replace(guard, guard+guard, 1),
                original.replace(start, "wrong anchor", 1),
                original + start + "\n",
            ):
                with self.subTest(case=case,bad=bad[:24]):
                    with self.assertRaises(ValueError):
                        one_guard_probe(bad,case)
        with self.assertRaises(ValueError):
            one_guard_probe(CHAT.replace("&& atrioGroupAdmin(groupId)","&& true"),
                            "chat_general")

    def test_unknown_case_and_non_text_input_are_refused(self):
        for sample,case in ((None,"reply_notice"),(33,"chat_general"),
                            ("", "other"),("x"*200001,"chat_general")):
            with self.subTest(case=case), self.assertRaises(ValueError):
                one_guard_probe(sample,case)

    def test_report_labels_do_not_claim_correction_or_accuracy(self):
        self.assertEqual(set(LABELS), {"reply_notice", "chat_general"})
        self.assertTrue(all(x.startswith("diagnostic_") for x in LABELS.values()))


if __name__ == "__main__":
    unittest.main()
