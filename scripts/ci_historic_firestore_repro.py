#!/usr/bin/env python3
"""Execute two pinned historical Firestore tests in a demo-only emulator.

A failed historical test is an OBSERVATION, not a proven root cause. The
runner never prints or archives its raw test stdout/stderr, only safe codes.
No production Firebase credentials, re-runs, deploys, or repo writes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
PROJECT = "demo-atrio-v11"
CASES = {
    "reply_notice": {
        "sha": "43fac1b50ee12fa0ce1b505bf74ebabd4447e001",
        "prepare": ("node", "prepare.mjs"),
        "config": "firebase.json",
        "test": "node reply-notice-migration-lab.test.mjs",
        "timeout": 600,
    },
    "chat_general": {
        "sha": "422d00ccbd9ef3c7dce11252be045daf656b8e09",
        "prepare": ("node", "../../firebase/qa-general/compose-rules.mjs"),
        "config": "qa-general.firebase.json",
        "test": "node qa-general-firestore.test.mjs",
        "timeout": 720,
    },
}
NOTICE_BEFORE = "PASS NOTICE-LAB resposta direta sem aviso ao destinatario e rejeitada"
NOTICE_AFTER = "PASS NOTICE-LAB resposta direta com aviso ao autor e destinatario passa"


def inspect_outcome(case, exit_code, log):
    """Report only observable markers. Never infer causality or emit log text."""
    if case not in CASES or type(exit_code) is not int or not isinstance(log, str):
        raise ValueError("invalid forensic outcome input")
    denied = "PERMISSION_DENIED" in log or "permission-denied" in log
    rule_limit = "maximum of 1000 expressions" in log.lower()
    direct_before = NOTICE_BEFORE in log if case == "reply_notice" else False
    direct_after = NOTICE_AFTER in log if case == "reply_notice" else False
    if exit_code == 0:
        status = "historical_failure_not_reproduced"
    elif case == "reply_notice" and denied and direct_before and not direct_after:
        status = "historical_positive_batch_denied_symptom_reproduced"
    elif case == "chat_general" and denied and rule_limit:
        status = "permission_denied_and_rule_limit_symptoms_reproduced"
    elif case == "chat_general" and denied:
        status = "permission_denied_symptom_reproduced_without_limit"
    elif case == "reply_notice" and denied:
        status = "permission_denied_seen_without_full_sequence_match"
    else:
        status = "different_failure_or_setup_problem"
    return {
        "scenario": case,
        "historical_checkout_sha": CASES[case]["sha"],
        "test_exit_code": exit_code,
        "classification": status,
        "permission_denied_seen": denied,
        "max_1000_rule_expressions_seen": rule_limit,
        "notice_previous_negative_case_passed": direct_before,
        "notice_positive_case_passed": direct_after,
        "log_sha256": hashlib.sha256(log.encode("utf-8")).hexdigest(),
        "raw_log_stored_or_published": False,
        "root_cause_proven": False,
        "human_independent_review_completed": False,
        "real_auto_repair_executed": False,
        "diagnostic_accuracy_pct": None,
        "eligible_auto_repair_pct": None,
        "production_writes": 0,
    }


def safe_environment(env):
    if env.get("GOOGLE_CLOUD_PROJECT") != PROJECT:
        raise ValueError("demo project is mandatory")
    for name in (
        "FIREBASE_TOKEN", "GOOGLE_APPLICATION_CREDENTIALS", "GCLOUD_PROJECT",
        "GOOGLE_CLOUD_QUOTA_PROJECT", "GOOGLE_AUTH_SUPPRESS_CREDENTIALS_WARNINGS",
        "ATRIO_PUSH_WORKER_URL", "ATRIO_AVATAR_WORKER_URL",
        "ATRIO_GUARDIAN_V2_WORKER_URL", "ATRIO_SIGNING_STORE_PASSWORD",
        "ATRIO_SIGNING_KEY_PASSWORD",
    ):
        if env.get(name):
            raise ValueError("non-demo identity or production variable refused")
    if env.get("GITHUB_REPOSITORY") not in (None, REPO):
        raise ValueError("unexpected GitHub repository")
    return {**env, "GOOGLE_CLOUD_PROJECT": PROJECT,
            "FIREBASE_TOKEN": "", "GOOGLE_APPLICATION_CREDENTIALS": "",
            "FIREBASE_PROJECT": PROJECT, "CI": "true"}


def execute(case, historical, output, env=None):
    if case not in CASES:
        raise ValueError("unknown historic scenario")
    root = Path(historical).resolve()
    destination = Path(output).resolve()
    source = CASES[case]
    if root == destination or root in destination.parents:
        raise ValueError("cannot write within historical source checkout")
    work = root / "tests" / "security"
    if destination.exists() or not work.is_dir():
        raise ValueError("output exists or checkout is missing")
    secure_env = safe_environment(dict(os.environ if env is None else env))
    checkout = subprocess.run(
        ("git", "rev-parse", "HEAD"), cwd=root,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        timeout=15, check=False)
    if checkout.returncode != 0 or checkout.stdout.strip() != source["sha"]:
        raise ValueError("checkout SHA differs from the exact historic job")
    # Preparing the generated QA rules is confined to a disposable checkout.
    prep = subprocess.run(
        source["prepare"], cwd=work, env=secure_env,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, errors="replace", timeout=75, check=False)
    if prep.returncode != 0:
        raise ValueError("historical demo rules preparation failed")
    command = (
        "./node_modules/.bin/firebase", "emulators:exec", "--only", "firestore",
        "--config", source["config"], "--project", PROJECT, source["test"])
    try:
        run = subprocess.run(
            command, cwd=work, env=secure_env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, errors="replace", timeout=source["timeout"],
            check=False)
        result = inspect_outcome(case, run.returncode, run.stdout)
    except subprocess.TimeoutExpired:
        result = inspect_outcome(case, 124, "")
        result["classification"] = "qa_infrastructure_or_test_timeout"
    result["mode"] = "historical_checkout_demo_emulator_only"
    result["setup_was_executed"] = True
    result["output_does_not_contain_raw_logs"] = True
    # Mode x prevents clobbering a pre-existing file, even through symlinks.
    with destination.open("x", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--scenario", choices=sorted(CASES), required=True)
    p.add_argument("--historical", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()
    result = execute(args.scenario, args.historical, args.output)
    print("QA historic Firestore:", result["scenario"], result["classification"],
          "exit_code=", result["test_exit_code"],
          "root_cause_proven=false, production_writes=0")
    # A matching symptom is a completed forensic experiment, not a passing test.
    # Infra/setup defects should remain visible as failing QA checks.
    if result["classification"] in (
            "different_failure_or_setup_problem", "qa_infrastructure_or_test_timeout"):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
