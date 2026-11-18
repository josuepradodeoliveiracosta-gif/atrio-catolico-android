#!/usr/bin/env python3
"""Forensic counterfactuals for one accepted group invite and one direct notice.

Only optimize repeated reads of the *same* referenced document inside local
emulator-only test Rules. Keep original predicates, source SHAs and assertions.
This is an experiment, NEVER a production Rules patch or a causal verdict.
"""
import argparse

from scripts.ci_historic_firestore_differential import execute
from scripts.ci_historic_firestore_repro import CASES

NOTICE_FUNCTION = "      function canonicalDirectRecipient() {\n"
NOTICE_READS = (
    "getAfter(currentPath).data.get('replyToId', '') == targetId\n"
    "          && getAfter(currentPath).data.get('replyToUid', '') == recipientUid"
)
NOTICE_HELPER = (
    "      // QA only: reuse one after-state snapshot of the cited new reply.\n"
    "      function qaDirectReplySnapshotMatches(path, targetId) {\n"
    "        let doc = getAfter(path).data;\n"
    "        return doc.get('replyToId', '') == targetId\n"
    "          && doc.get('replyToUid', '') == recipientUid;\n"
    "      }\n"
)
GROUP_START = "      allow create: if atrioGroupsEnabled() && validId(inviteeUid)"
GROUP_END = "        allow update: if atrioGroupsEnabled()"
GROUP_READ = "get(atrioGroupPath(groupId)).data"


def cached_predicate_counterfactual(source, case):
    """Fail closed on unexpected source; preserve all boolean conditions."""
    if not isinstance(source, str) or case not in CASES:
        raise ValueError("unsupported historical predicate")
    if case == "reply_notice":
        if source.count(NOTICE_FUNCTION) != 1 or source.count(NOTICE_READS) != 1:
            raise ValueError("notice predicate anchor changed")
        out = source.replace(NOTICE_FUNCTION, NOTICE_HELPER + NOTICE_FUNCTION, 1)
        out = out.replace(NOTICE_READS, "qaDirectReplySnapshotMatches(currentPath, targetId)", 1)
        if out.count("qaDirectReplySnapshotMatches(currentPath, targetId)") != 1:
            raise ValueError("notice counterfactual did not match")
        return out

    if source.count(GROUP_START) != 1:
        raise ValueError("group invite anchor missing")
    start = source.index(GROUP_START)
    end = source.find(GROUP_END, start)
    if end < 0:
        raise ValueError("group invite closing anchor missing")
    segment = source[start:end]
    if segment.count(GROUP_READ) != 3 or segment.count("atrioGroupAcceptedContact(") != 1:
        raise ValueError("group invite guards or document reads changed")
    if not segment.rstrip().endswith(";"):
        raise ValueError("unexpected group invite statement")
    condition = segment.split(": if ", 1)[1].rstrip().removesuffix(";")
    expected_guards = (
        "qaChatAge16Eligible(inviteeUid)",
        "atrioGroupAdmin(groupId)",
        "atrioGroupAcceptedContact(",
        "request.resource.data.createdAt == request.time",
        "request.resource.data.updatedAt == request.time",
        "!exists(/databases/$(database)/documents/users/$(inviteeUid)/blockedMembers/$(request.auth.uid))",
    )
    if any(guard not in condition for guard in expected_guards):
        raise ValueError("invite prerequisite missing")
    condition = condition.replace(GROUP_READ, "group")
    replacement = (
        "      // QA only: same original guards, one snapshot of group metadata.\n"
        "      function qaCachedInviteCreate(groupId, inviteeUid) {\n"
        "        let group = get(atrioGroupPath(groupId)).data;\n"
        "        return " + condition + ";\n"
        "      }\n"
        "      allow create: if qaCachedInviteCreate(groupId, inviteeUid);\n"
    )
    result = source[:start] + replacement + source[end:]
    if result.count(GROUP_READ) >= source.count(GROUP_READ):
        raise ValueError("group read deduplication missing")
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--scenario", required=True, choices=sorted(CASES))
    p.add_argument("--historical", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()
    verdict = execute(
        args.scenario, args.historical, args.output,
        patcher=cached_predicate_counterfactual,
        label=("cached_direct_notification_reply_snapshot"
               if args.scenario == "reply_notice"
               else "cached_group_invite_metadata_snapshot"))
    baseline, variant = verdict["control_and_variant"]
    print("QA predicate experiment:", args.scenario,
          "baseline_exit=", baseline["exit_code"],
          "variant_exit=", variant["exit_code"],
          "baseline_stage=", baseline["last_started_stage"],
          "variant_stage=", variant["last_started_stage"],
          "root_cause_proven=false")
    if 124 in (baseline["exit_code"], variant["exit_code"]):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
