#!/usr/bin/env python3
"""Controlled Firestore Rules counterfactuals on two pinned historical tests.

Always run baseline AND one narrow variant with identical synthetic fixtures,
isolated Firebase Emulators, and separate empty databases. Never infer a
verified root cause. Do not upload raw logs or modified historical sources.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

from scripts.ci_historic_firestore_repro import (
    CASES, PROJECT, safe_environment,
)

PATCH_NOTICE_FROM = (
    "get(/databases/$(database)/documents/posts/$(postId)/replies/"
    "$(request.resource.data.replyToId)).data.uid")
PATCH_NOTICE_TO = PATCH_NOTICE_FROM.replace("get(", "getAfter(", 1)
PATCH_QUOTA_FROM = """    function chatQuotaMatches(uid, chatId) {
      return existsAfter(chatQuotaPath(uid))
        && getAfter(chatQuotaPath(uid)).data.lastChatId == chatId
        && getAfter(chatQuotaPath(uid)).data.updatedAt == request.time
        && getAfter(chatQuotaPath(uid)).data.count >= 1
        && getAfter(chatQuotaPath(uid)).data.count <= 5;
    }"""
PATCH_QUOTA_TO = """    function chatQuotaMatches(uid, chatId) {
      let quota = getAfter(chatQuotaPath(uid)).data;
      return existsAfter(chatQuotaPath(uid))
        && quota.lastChatId == chatId
        && quota.updatedAt == request.time
        && quota.count >= 1
        && quota.count <= 5;
    }"""

NOTICE_STAGES = [
    ("notice_canonical_batch", "  await check('resposta e aviso canonicos no batch passam',"),
    ("notice_missing_direct_notice", "  await check('resposta direta sem aviso ao destinatario e rejeitada',"),
    ("notice_direct_both_positive", "  await check('resposta direta com aviso ao autor e destinatario passa',"),
    ("notice_mention_negative", "  await check('mencao sem aviso ao membro mencionado e rejeitada',"),
]


def patch_rules(source, case):
    """One precisely bounded counterfactual; never remove a safety guard."""
    if not isinstance(source, str) or case not in CASES:
        raise ValueError("unexpected historical source or scenario")
    if case == "reply_notice":
        old, new = PATCH_NOTICE_FROM, PATCH_NOTICE_TO
    else:
        old, new = PATCH_QUOTA_FROM, PATCH_QUOTA_TO
    if source.count(old) != 1:
        raise ValueError("historical source patch anchor is not unique")
    patched = source.replace(old, new)
    if patched == source or patched.count(new) != 1:
        raise ValueError("historical patch did not change one target")
    return patched


def instrument_historical_test(source, case):
    if not isinstance(source, str) or case not in CASES:
        raise ValueError("unsupported historical test")
    if "QA_FORENSIC_STAGE:" in source:
        raise ValueError("historical test already instrumented")
    if case == "reply_notice":
        output = source
        for stage, target in NOTICE_STAGES:
            if output.count(target) != 1:
                raise ValueError("ambiguous historic notice stage")
            output = output.replace(
                target, "  console.log('QA_FORENSIC_STAGE:" + stage + "');\n" +
                target, 1)
    else:
        # Observe the last top-level awaited step in this synthetic QA suite,
        # without changing its assertions, permission grants or call ordering.
        if source.count("try {\n  await env.clearFirestore();") != 1:
            raise ValueError("unexpected historic chat test structure")
        lines = source.splitlines(keepends=True)
        output_lines = []
        count = 0
        active = False
        for number, line in enumerate(lines, start=1):
            if line == "try {\n":
                active = True
            if active and line.startswith("  await "):
                output_lines.append(
                    "  console.log('QA_FORENSIC_STAGE:chat_line_" +
                    str(number) + "');\n")
                count += 1
            output_lines.append(line)
        if not 10 <= count <= 180:
            raise ValueError("unexpected number of QA stage markers")
        output = "".join(output_lines)
    return output


def evaluate(case, phase, code, log):
    """Emit only predeclared stage/flag values and a digest, never log text."""
    if case not in CASES or phase not in ("baseline", "counterfactual"):
        raise ValueError("invalid experiment")
    if type(code) is not int or not isinstance(log, str):
        raise ValueError("invalid outcome")
    stages = []
    for line in log.splitlines():
        if line.startswith("QA_FORENSIC_STAGE:"):
            stage = line.partition(":")[2].strip()
            if ((case == "reply_notice" and
                 stage in {name for name, _ in NOTICE_STAGES}) or
                    (case == "chat_general" and
                     stage.startswith("chat_line_") and
                     stage[10:].isdigit() and
                     1 <= int(stage[10:]) <= 440)):
                stages.append(stage)
    last = stages[-1] if stages else None
    passed_notice_positive = (
        "PASS NOTICE-LAB resposta direta com aviso ao autor e destinatario passa" in log)
    return {
        "phase": phase,
        "exit_code": code,
        "test_succeeded": code == 0,
        "last_started_stage": last,
        "observed_stage_count": len(stages),
        "permission_denied_seen_somewhere": "PERMISSION_DENIED" in log,
        "expression_limit_seen_somewhere": "maximum of 1000 expressions" in log.lower(),
        "notice_positive_direct_batch_passed": (
            passed_notice_positive if case == "reply_notice" else None),
        "log_sha256": hashlib.sha256(log.encode("utf-8")).hexdigest(),
        "raw_log_published": False,
    }


def _run(command, cwd, env, timeout):
    try:
        z = subprocess.run(
            command, cwd=cwd, env=env, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, errors="replace",
            check=False, timeout=timeout)
        return z.returncode, z.stdout
    except subprocess.TimeoutExpired:
        return 124, ""


def execute(case, historical, output, env=None):
    if case not in CASES:
        raise ValueError("unsupported scenario")
    root = Path(historical).resolve()
    dest = Path(output).resolve()
    work = root / "tests" / "security"
    if root == dest or root in dest.parents or dest.exists() or not work.is_dir():
        raise ValueError("invalid source or destination")
    sec = safe_environment(dict(os.environ if env is None else env))
    rev = subprocess.run(
        ("git", "rev-parse", "HEAD"), cwd=root,
        capture_output=True, text=True, timeout=15, check=False)
    if rev.returncode or rev.stdout.strip() != CASES[case]["sha"]:
        raise ValueError("historical commit SHA mismatch")
    setup = CASES[case]
    ok, _ = _run(setup["prepare"], work, sec, 90)
    if ok:
        raise ValueError("failed to prepare ephemeral historical rules")

    rules_path = work / ("firestore.rules" if case == "reply_notice"
                         else "qa-general.generated.rules")
    script_path = work / ("reply-notice-migration-lab.test.mjs"
                          if case == "reply_notice"
                          else "qa-general-firestore.test.mjs")
    temp_test = work / ".atrio_historic_differential_forensic.mjs"
    if temp_test.exists() or rules_path.is_symlink() or script_path.is_symlink():
        raise ValueError("forensic source path is unsafe")
    original_rules = rules_path.read_text(encoding="utf-8")
    copy_test = instrument_historical_test(
        script_path.read_text(encoding="utf-8"), case)
    modified_rules = patch_rules(original_rules, case)
    output_rows = []
    # Test source is copied to a single untracked file in the ephemeral
    # historical checkout, so Node resolves its pinned node_modules normally.
    try:
        with temp_test.open("x", encoding="utf-8") as w:
            w.write(copy_test)
        for phase, rules in (
                ("baseline", original_rules),
                ("counterfactual", modified_rules)):
            rules_path.write_text(rules, encoding="utf-8")
            cmd = (
                "./node_modules/.bin/firebase", "emulators:exec", "--only",
                "firestore", "--config", setup["config"], "--project", PROJECT,
                "node " + temp_test.name,
            )
            exit_code, log = _run(cmd, work, sec, setup["timeout"])
            row = evaluate(case, phase, exit_code, log)
            row["candidate_rules_sha256"] = hashlib.sha256(
                rules.encode("utf-8")).hexdigest()
            output_rows.append(row)
    finally:
        rules_path.write_text(original_rules, encoding="utf-8")
        temp_test.unlink(missing_ok=True)

    data = {
        "schema_version": 1,
        "mode": "two_fresh_emulators_same_historical_fixture",
        "scenario": case,
        "historical_checkout_sha": setup["sha"],
        "control_and_variant": output_rows,
        "counterfactual_kind": (
            "replace_one_existing_reply_get_with_getAfter"
            if case == "reply_notice"
            else "reuse_one_getAfter_quota_snapshot_instead_of_four_reads"),
        "baseline_and_variant_same_source": False,
        "tests_originally_failing_may_remain_failing": True,
        "no_security_rules_deployed": True,
        "human_review_adjudicated": False,
        "root_cause_proven": False,
        "automatic_repair_performed": False,
        "causal_accuracy_pct": None,
        "automatic_repair_pct": None,
        "production_writes": 0,
        "raw_logs_published": False,
    }
    # Safe output; never print private logs and never overwrite an existing file.
    with dest.open("x", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", choices=sorted(CASES), required=True)
    parser.add_argument("--historical", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    report = execute(args.scenario, args.historical, args.output)
    baseline, alternative = report["control_and_variant"]
    print("Firestore comparison:", args.scenario,
          "baseline_exit=", baseline["exit_code"],
          "variant_exit=", alternative["exit_code"],
          "baseline_stage=", baseline["last_started_stage"],
          "variant_stage=", alternative["last_started_stage"],
          "root_cause_proven=false")
    # Timeout/failed setup is not evidence of rule causality.
    if 124 in (baseline["exit_code"], alternative["exit_code"]):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
