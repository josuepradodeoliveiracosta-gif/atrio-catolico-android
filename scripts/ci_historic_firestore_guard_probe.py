#!/usr/bin/env python3
"""ONE-GUARD counterfactuals in disposable historical Firestore Emulators.

WARNING: these variants intentionally OMIT one authorization check, only to
test hypotheses. They are unsafe to deploy, not product fixes or approvals.
Every original positive/negative historical assertion is preserved, and
original source Rules are restored after each isolated emulator run.
"""
import argparse

from scripts.ci_historic_firestore_differential import execute
from scripts.ci_historic_firestore_repro import CASES

NOTICE_START = "      function canonicalDirectRecipient() {\n"
NOTICE_END = "      function canonicalMentionRecipient() {\n"
NOTICE_GUARD = (
    "          && exists(/databases/$(database)/documents/posts/"
    "$(request.resource.data.postId)/replies/$(targetId))\n"
)
CHAT_START = "      allow create: if atrioGroupsEnabled() && validId(inviteeUid)"
CHAT_END = "        allow update: if atrioGroupsEnabled()"
CHAT_GUARD = (
    "          && atrioGroupAcceptedContact(\n"
    "            request.auth.uid,inviteeUid,request.resource.data.contactChatId);"
)
# Intentionally unsafe QA-only variants: NEVER merge into product Rules.
LABELS = {
    "reply_notice": "diagnostic_omit_one_existing_reply_exists_guard",
    "chat_general": "diagnostic_omit_accepted_contact_invite_guard",
}


def one_guard_probe(source, case):
    if case not in CASES or not isinstance(source, str) or len(source) > 200000:
        raise ValueError("invalid or oversized historical candidate Rules")
    start, end, guard = (
        (NOTICE_START, NOTICE_END, NOTICE_GUARD)
        if case == "reply_notice" else (CHAT_START, CHAT_END, CHAT_GUARD)
    )
    if source.count(start) != 1:
        raise ValueError("historical allow-create/function anchor not unique")
    begin = source.index(start)
    close = source.find(end, begin + len(start))
    if close < 0 or close <= begin:
        raise ValueError("historic predicate boundary absent")
    scoped = source[begin:close]
    if scoped.count(guard) != 1:
        raise ValueError("one investigated guard must exist exactly once")
    if case == "reply_notice":
        if ("&& getAfter(currentPath)" not in scoped
                or "get(/databases/$(database)/documents/posts/" not in scoped):
            raise ValueError("canonical notice safety context changed")
        altered = scoped.replace(guard, "", 1)
    else:
        for required in (
            "&& qaChatAge16Eligible(inviteeUid)",
            "&& atrioGroupAdmin(groupId)",
            "&& !exists(/databases/$(database)/documents/users/$(inviteeUid)/blockedMembers/",
            "request.resource.data.status == 'pending'",
            "request.resource.data.createdAt == request.time",
        ):
            if required not in scoped:
                raise ValueError("group invite controls missing")
        altered = scoped.replace(
            guard,
            "          && true; // QA-ONLY OMIT CONTACT GUARD; NEVER DEPLOY",
            1,
        )
    result = source[:begin] + altered + source[close:]
    if result == source or result.count(guard) != source.count(guard) - 1:
        raise ValueError("unexpected narrow probe change")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", required=True, choices=sorted(CASES))
    parser.add_argument("--historical", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    report = execute(
        args.scenario, args.historical, args.output,
        patcher=one_guard_probe, label=LABELS[args.scenario],
    )
    baseline, variant = report["control_and_variant"]
    print("QA guard isolation:", args.scenario,
          "control_exit=", baseline["exit_code"],
          "experimental_exit=", variant["exit_code"],
          "unsafe_variant_qa_only=true",
          "root_cause_proven=false", "production_writes=0")
    if 124 in (baseline["exit_code"], variant["exit_code"]):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
