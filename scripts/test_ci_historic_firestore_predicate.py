"""Contract tests: preserve all historical security conditions under QA-only caching."""
import unittest

from scripts.ci_historic_firestore_predicate import (
    GROUP_READ, GROUP_START, GROUP_END,
    NOTICE_FUNCTION, NOTICE_READS,
    cached_predicate_counterfactual,
)


class PredicateComparisonTests(unittest.TestCase):
    def test_cached_direct_notification_keeps_recipient_and_exists_guards(self):
        doc = (
            NOTICE_FUNCTION +
            "        let currentPath = /databases/$(database)/documents/x;\n"
            "        let targetId = request.resource.data.get('replyToId', '');\n"
            "        return validId(targetId)\n"
            "          && existsAfter(currentPath)\n"
            "          && " + NOTICE_READS + "\n"
            "          && exists(/databases/$(database)/documents/y);\n"
            "      }\n"
        )
        new = cached_predicate_counterfactual(doc, "reply_notice")
        self.assertIn("existsAfter(currentPath)", new)
        self.assertIn("validId(targetId)", new)
        self.assertIn("doc.get('replyToUid', '') == recipientUid", new)
        self.assertIn("qaDirectReplySnapshotMatches(currentPath, targetId)", new)
        self.assertIn("getAfter(path).data", new)
        self.assertNotIn("allow read, write: if true", new)
        self.assertNotEqual(new, doc)

    def test_group_variant_keeps_all_guards_and_only_reuses_group_doc(self):
        expr = (
            GROUP_START + "\n"
            "          && qaChatAge16Eligible(inviteeUid)\n"
            "          && atrioGroupAdmin(groupId)\n"
            "          && " + GROUP_READ + ".status == 'active'\n"
            "          && " + GROUP_READ + ".memberUids.size() >= 1\n"
            "          && " + GROUP_READ + ".name == request.resource.data.groupName\n"
            "          && request.resource.data.createdAt == request.time\n"
            "          && request.resource.data.updatedAt == request.time\n"
            "          && !exists(/databases/$(database)/documents/users/$(inviteeUid)/blockedMembers/$(request.auth.uid))\n"
            "          && atrioGroupAcceptedContact(\n"
            "             request.auth.uid,inviteeUid,request.resource.data.contactChatId);\n"
        )
        doc = "match /atrioGroupInvites/{inviteeUid} {\n" + expr + GROUP_END + "\n}\n"
        new = cached_predicate_counterfactual(doc, "chat_general")
        self.assertEqual(new.count(GROUP_READ), 1)
        self.assertIn("qaCachedInviteCreate(groupId, inviteeUid)", new)
        self.assertIn("group.memberUids", new)
        self.assertIn("group.name", new)
        self.assertIn("atrioGroupAcceptedContact(", new)
        self.assertIn("qaChatAge16Eligible(inviteeUid)", new)
        self.assertIn("atrioGroupAdmin(groupId)", new)
        self.assertIn("!exists(/databases/", new)
        self.assertIn("request.resource.data.createdAt == request.time", new)
        self.assertIn("request.resource.data.updatedAt == request.time", new)

    def test_missing_or_tampered_security_guard_refuses_patch(self):
        segment = (
            GROUP_START + "\n"
            "          && " + GROUP_READ + ".name == 'x'\n"
            "          && " + GROUP_READ + ".status == 'active'\n"
            "          && " + GROUP_READ + ".memberUids.size() == 1;\n" +
            GROUP_END + "\n"
        )
        for value, case in (
            (segment, "chat_general"),
            (NOTICE_FUNCTION + "}", "reply_notice"),
            (NOTICE_FUNCTION + NOTICE_FUNCTION + NOTICE_READS, "reply_notice"),
            ("malformed", "forged_case"),
        ):
            with self.subTest(case=case), self.assertRaises(ValueError):
                cached_predicate_counterfactual(value, case)

    def test_original_source_does_not_acquire_new_grants_or_tokens(self):
        baseline = (NOTICE_FUNCTION + "return " + NOTICE_READS + ";")
        candidate = cached_predicate_counterfactual(baseline, "reply_notice")
        self.assertNotIn("allow create: if true;", candidate)
        self.assertNotIn("allow read, write: if true;", candidate)
        self.assertNotIn("FIREBASE_TOKEN", candidate)


if __name__ == "__main__":
    unittest.main()
