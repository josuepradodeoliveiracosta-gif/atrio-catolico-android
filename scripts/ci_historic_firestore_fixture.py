#!/usr/bin/env python3
"""Read-only synthetic fixture integrity probe at two exact historical failures.

Runs only on a pinned checkout in demo-atrio-v11 Firestore Emulator. The
fixture read uses the testing SDK's local, temporary rules-disabled callback
and DOES NOT modify the rules source or bypass any original test assertion.
Raw logs and document values are never exported.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

from scripts.ci_historic_firestore_repro import CASES, PROJECT, safe_environment
from scripts.ci_historic_firestore_differential import _run

MARKER = "QA_FOR_FIXTURE:"
NOTICE_ANCHOR = "  await check('resposta direta com aviso ao autor e destinatario passa',async()=>{"
CHAT_ANCHOR = " await assertSucceeds(newInvite());"

NOTICE_KEYS = (
    "post_exists", "post_owner_is_expected", "cited_reply_exists",
    "cited_reply_owner_is_expected", "sender_profile_matches",
)
CHAT_KEYS = (
    "chat_exists", "chat_status_accepted", "group_exists", "group_status_active",
    "group_admin_contains_inviter", "invitee_not_member",
    "chat_config_valid", "group_config_valid", "inviter_age_valid",
    "invitee_age_valid", "inviter_group_eligible", "invitee_group_eligible",
    "recipient_has_not_blocked_inviter",
)
KEYS = {"reply_notice": NOTICE_KEYS, "chat_general": CHAT_KEYS}

NOTICE_SENSOR = r'''
async function qaSyntheticFixtureProbe() {
  let row = {probe_unavailable:true};
  try {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      const [post, seed, profile] = await Promise.all([
        getDoc(doc(db,'posts',postId)),
        getDoc(doc(db,'posts',postId,'replies','lucia_seed')),
        getDoc(doc(db,'profiles',mi))
      ]);
      row = {
        post_exists: post.exists(),
        post_owner_is_expected: post.exists() && post.data()?.uid === ca,
        cited_reply_exists: seed.exists(),
        cited_reply_owner_is_expected: seed.exists() && seed.data()?.uid === lu,
        sender_profile_matches: profile.exists() && profile.data()?.displayName === 'Miguel QA'
      };
    });
  } catch (_) {
    row = {probe_unavailable:true};
  }
  console.log('QA_FOR_FIXTURE:' + JSON.stringify(row));
}
'''

CHAT_SENSOR = r'''
async function qaSyntheticFixtureProbe() {
  let row = {probe_unavailable:true};
  let stage = 'initializing';
  try {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      const read = async (step, path) => {
        stage = step;
        return await getDoc(doc(db,path));
      };
      const contact = await read('read_contact', room);
      const group = await read('read_group', inviteGroup);
      const conversations = await read('read_chat_policy', 'app_config/conversations');
      const groupsPolicy = await read('read_group_policy', 'app_config/chat_groups');
      const inviterAge = await read('read_inviter_age', aliceAge);
      const inviteeAge = await read('read_invitee_age', bobAge);
      const inviterGroup = await read('read_inviter_group', 'users/qa-alice/chatGroupAccess/eligibility');
      const inviteeGroup = await read('read_invitee_group', 'users/qa-bob/chatGroupAccess/eligibility');
      const inverseBlock = await read('read_inverse_block', 'users/qa-bob/blockedMembers/qa-alice');
      stage = 'evaluate_flags';
      const expiryValid = s => s.exists() && s.data()?.reviewExpiresAt?.toMillis?.() > Date.now();
      const ageValid = s => expiryValid(s) && s.data()?.status === 'eligible' &&
         s.data()?.minimumAge === 16 && s.data()?.policyVersion === '2026-11-16plus-qa-v1';
      const groupValid = s => expiryValid(s) && s.data()?.status === 'approved' &&
         s.data()?.policyVersion === '2026-11-group-safety-v1';
      row = {
        chat_exists: contact.exists(),
        chat_status_accepted: contact.exists() && contact.data()?.status === 'accepted',
        group_exists: group.exists(),
        group_status_active: group.exists() && group.data()?.status === 'active',
        group_admin_contains_inviter: group.exists() && group.data()?.adminUids?.includes('qa-alice') === true,
        invitee_not_member: group.exists() && !group.data()?.memberUids?.includes('qa-bob'),
        chat_config_valid: conversations.exists() && conversations.data()?.enabled === true &&
           conversations.data()?.minorPolicyApproved === true &&
           conversations.data()?.safetyReviewVersion === '2026-11-safety-v1' &&
           conversations.data()?.version === '2026-11-v1',
        group_config_valid: groupsPolicy.exists() && groupsPolicy.data()?.enabled === true &&
           groupsPolicy.data()?.minorPolicyApproved === true &&
           groupsPolicy.data()?.version === '2026-11-groups-v1',
        inviter_age_valid: ageValid(inviterAge),
        invitee_age_valid: ageValid(inviteeAge),
        inviter_group_eligible: groupValid(inviterGroup),
        invitee_group_eligible: groupValid(inviteeGroup),
        recipient_has_not_blocked_inviter: !inverseBlock.exists()
      };
    });
  } catch (error) {
    const name = String(error?.name || '');
    const category = ['FirebaseError','TypeError','RangeError','Error'].includes(name)
      ? name : 'other';
    row = {probe_unavailable:true, stage, category};
  }
  console.log('QA_FOR_FIXTURE:' + JSON.stringify(row));
}
'''


def instrument(source, scenario):
    if scenario not in CASES or not isinstance(source, str) or MARKER in source:
        raise ValueError("invalid historical test or unexpected probe")
    anchor, sensor = (
        (NOTICE_ANCHOR, NOTICE_SENSOR)
        if scenario == "reply_notice" else (CHAT_ANCHOR, CHAT_SENSOR))
    if source.count(anchor) != 1 or source.count("try {\n") < 1:
        raise ValueError("historical probe anchor is no longer unique")
    source = source.replace("try {\n", sensor + "\ntry {\n", 1)
    return source.replace(anchor, "  await qaSyntheticFixtureProbe();\n" + anchor, 1)


def classify_fixture(log, scenario):
    if scenario not in CASES or not isinstance(log, str) or len(log) > 12000000:
        raise ValueError("unknown fixture or oversized forensic log")
    found = [line[len(MARKER):] for line in log.splitlines()
             if line.startswith(MARKER)]
    if len(found) != 1 or len(found[0]) > 4096:
        return {"status": "marker_missing_or_ambiguous", "booleans": {}}
    try:
        raw = json.loads(found[0])
    except (ValueError, TypeError):
        return {"status": "invalid_marker", "booleans": {}}
    if isinstance(raw, dict) and raw.get("probe_unavailable") is True:
        allowed_stages = {
            "initializing", "read_contact", "read_group", "read_chat_policy",
            "read_group_policy", "read_inviter_age", "read_invitee_age",
            "read_inviter_group", "read_invitee_group", "read_inverse_block",
            "evaluate_flags",
        }
        allowed_categories = {"FirebaseError", "TypeError", "RangeError", "Error", "other"}
        if (set(raw) == {"probe_unavailable", "stage", "category"}
                and raw["stage"] in allowed_stages
                and raw["category"] in allowed_categories):
            return {"status": "probe_unavailable", "stage": raw["stage"],
                    "failure_category": raw["category"], "booleans": {}}
    if not isinstance(raw, dict) or set(raw) != set(KEYS[scenario]) or any(
            type(raw[k]) is not bool for k in KEYS[scenario]):
        return {"status": "probe_unavailable_or_unexpected_schema", "booleans": {}}
    flags = {k: raw[k] for k in KEYS[scenario]}
    return {
        "status": ("all_expected_fixtures_present" if all(flags.values())
                   else "fixture_mismatch_observed"),
        "booleans": flags,
        "expected_flag_count": len(flags),
        "unexpected_flags_count": sum(v is False for v in flags.values()),
        "root_cause_proven": False,
    }


def execute(case, historical, output, env=None):
    if case not in CASES:
        raise ValueError("unsupported demo forensic scenario")
    root, dest = Path(historical).resolve(), Path(output).resolve()
    work = root / "tests" / "security"
    if not work.is_dir() or root == dest or root in dest.parents or dest.exists():
        raise ValueError("output must be outside the historic checkout and absent")
    secured = safe_environment(dict(os.environ if env is None else env))
    rev = subprocess.run(("git","rev-parse","HEAD"), cwd=root,
                         capture_output=True, text=True, timeout=15, check=False)
    if rev.returncode or rev.stdout.strip() != CASES[case]["sha"]:
        raise ValueError("historical SHA mismatch")
    prepare, _ = _run(CASES[case]["prepare"], work, secured, 90)
    if prepare:
        raise ValueError("demo-only rules preparation failed")
    test_path = work / ("reply-notice-migration-lab.test.mjs" if case == "reply_notice"
                        else "qa-general-firestore.test.mjs")
    tmp = work / ".atrio_fixture_readonly_probe.mjs"
    if test_path.is_symlink() or tmp.exists():
        raise ValueError("unsafe test path")
    body = instrument(test_path.read_text(encoding="utf-8"), case)
    try:
        with tmp.open("x", encoding="utf-8") as handle:
            handle.write(body)
        cmd = ("./node_modules/.bin/firebase","emulators:exec","--only",
               "firestore","--config",CASES[case]["config"],
               "--project",PROJECT,"node " + tmp.name)
        exit_code, log = _run(cmd, work, secured, CASES[case]["timeout"])
        report = {
            "schema": 1, "case": case, "checkout_sha": CASES[case]["sha"],
            "mode": "demo_emulator_synthetic_fixture_readonly",
            "test_exit_code": exit_code,
            "fixture": classify_fixture(log, case),
            "log_sha256": hashlib.sha256(log.encode("utf-8")).hexdigest(),
            "raw_log_published": False, "document_values_published": False,
            "security_rules_changed": False, "production_writes": 0,
            "root_cause_proven": False, "independent_review_completed": False,
            "automatic_repair_executed": False, "accuracy_pct": None,
        }
        with dest.open("x", encoding="utf-8") as writer:
            json.dump(report, writer, indent=2, ensure_ascii=False, sort_keys=True)
            writer.write("\n")
        return report
    finally:
        tmp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", required=True, choices=sorted(CASES))
    parser.add_argument("--historical", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = execute(args.scenario,args.historical,args.output)
    print("Synthetic fixture audit:",args.scenario,result["fixture"]["status"],
          "test_exit=",result["test_exit_code"],"root_cause_proven=false")
    if result["test_exit_code"] == 124:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
