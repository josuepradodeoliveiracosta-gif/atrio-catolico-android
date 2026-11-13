#!/usr/bin/env python3
"""Emulator-only evaluation of the accepted-contact guard, without bypassing it.

The Firebase Rules debug() call returns the SAME boolean as its argument. Raw
firestore-debug.log, test output and documents stay in a disposable checkout;
only a tiny allowlisted count/classification is retained. NEVER deploy.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from scripts.ci_historic_firestore_repro import CASES, PROJECT, safe_environment
from scripts.ci_historic_firestore_differential import (
    _run, evaluate, instrument_historical_test,
)

CASE = "chat_general"
CREATE_START = "      allow create: if atrioGroupsEnabled() && validId(inviteeUid)"
CREATE_END = "        allow update: if atrioGroupsEnabled()"
CONTACT_CALL = (
    "          && atrioGroupAcceptedContact(\n"
    "            request.auth.uid,inviteeUid,request.resource.data.contactChatId);"
)
DEBUG_CALL = CONTACT_CALL.replace(
    "&& atrioGroupAcceptedContact(", "&& debug(atrioGroupAcceptedContact(", 1
).replace("request.resource.data.contactChatId);", "request.resource.data.contactChatId));", 1)

DEBUG_LINE = re.compile(r"(?m)^\s*bool_value:\s*(true|false)\s*$")
MAX_DEBUG_BYTES = 8 * 1024 * 1024


def instrument_contact_debug(source):
    """Preserve every guard; wrap only the chosen create-time predicate."""
    if not isinstance(source, str) or len(source) > 200000:
        raise ValueError("unexpected candidate Rules")
    if re.search(r"\bdebug\s*\(", source):
        raise ValueError("source contains preexisting debug calls")
    if source.count(CREATE_START) != 1:
        raise ValueError("group invite create anchor changed")
    begin = source.index(CREATE_START)
    end = source.find(CREATE_END, begin)
    if end <= begin:
        raise ValueError("group invite update anchor changed")
    segment = source[begin:end]
    if segment.count(CONTACT_CALL) != 1:
        raise ValueError("exact contact condition missing")
    for guard in (
        "qaChatAge16Eligible(inviteeUid)",
        "atrioGroupAdmin(groupId)",
        "request.resource.data.status == 'pending'",
        "!exists(/databases/$(database)/documents/users/$(inviteeUid)/blockedMembers/",
    ):
        if guard not in segment:
            raise ValueError("mandatory guard absent")
    changed = source[:begin] + segment.replace(
        CONTACT_CALL, DEBUG_CALL, 1
    ) + source[end:]
    if changed == source or changed.count(DEBUG_CALL) != 1:
        raise ValueError("debug wrapping was not unique")
    # This is instrumentation, not a new allow rule or a bypass.
    assert DEBUG_CALL.replace(
        "&& debug(atrioGroupAcceptedContact(", "&& atrioGroupAcceptedContact(", 1
    ).replace("request.resource.data.contactChatId));",
              "request.resource.data.contactChatId);", 1) == CONTACT_CALL
    return changed


def classify_debug_log(data):
    """Never return the log or its arbitrary text; ambiguous logs fail closed."""
    if data is None:
        return {"status": "log_unavailable", "true_count": 0, "false_count": 0}
    if not isinstance(data, bytes) or len(data) > MAX_DEBUG_BYTES:
        return {"status": "log_unavailable_or_oversized", "true_count": 0,
                "false_count": 0}
    raw = data.decode("utf-8", errors="replace")
    values = DEBUG_LINE.findall(raw)
    if len(values) > 100:
        return {"status": "too_many_debug_values", "true_count": 0,
                "false_count": 0}
    t = values.count("true")
    f = values.count("false")
    if t and f:
        status = "mixed_multiple_evaluations"
    elif t:
        status = "only_true_observed"
    elif f:
        status = "only_false_observed"
    else:
        status = "no_boolean_debug_observed"
    return {"status": status, "true_count": t, "false_count": f,
            "single_evaluation": len(values) == 1,
            "guard_value_is_not_independent_causal_proof": True}


def execute(historical, output, env=None):
    root, dest = Path(historical).resolve(), Path(output).resolve()
    work = root / "tests" / "security"
    if not work.is_dir() or dest.exists() or root == dest or root in dest.parents:
        raise ValueError("forensic input/output path mismatch")
    secure_env = safe_environment(dict(os.environ if env is None else env))
    git = subprocess.run(("git", "rev-parse", "HEAD"), cwd=root,
                         capture_output=True, text=True, check=False, timeout=15)
    if git.returncode or git.stdout.strip() != CASES[CASE]["sha"]:
        raise ValueError("historical source SHA mismatch")
    prepare, _ = _run(CASES[CASE]["prepare"], work, secure_env, 90)
    if prepare:
        raise ValueError("synthetic Rules preparation failed")
    rules_path = work / "qa-general.generated.rules"
    original_test = work / "qa-general-firestore.test.mjs"
    probe_test = work / ".atrio_contact_guard_debug_local.mjs"
    debug_path = work / "firestore-debug.log"
    if (rules_path.is_symlink() or original_test.is_symlink()
            or probe_test.exists() or debug_path.exists()
            or debug_path.is_symlink()):
        raise ValueError("unsafe historical checkout paths")
    rules = rules_path.read_text(encoding="utf-8")
    candidate = instrument_contact_debug(rules)
    test = instrument_historical_test(
        original_test.read_text(encoding="utf-8"), CASE)
    rows = []
    try:
        with probe_test.open("x", encoding="utf-8") as f:
            f.write(test)
        for phase, source in (("baseline", rules), ("debug_preserving_guard", candidate)):
            rules_path.write_text(source, encoding="utf-8")
            cmd = (
                "./node_modules/.bin/firebase", "emulators:exec", "--only",
                "firestore", "--config", CASES[CASE]["config"],
                "--project", PROJECT, "node " + probe_test.name,
            )
            code, log = _run(cmd, work, secure_env, CASES[CASE]["timeout"])
            row = evaluate(CASE, phase if phase == "baseline"
                           else "counterfactual", code, log)
            row["candidate_rules_sha256"] = hashlib.sha256(
                source.encode("utf-8")).hexdigest()
            if debug_path.is_symlink():
                raise ValueError("emulator debug log is a symlink")
            if phase == "debug_preserving_guard":
                raw = (debug_path.read_bytes()
                       if debug_path.is_file() and
                       debug_path.stat().st_size <= MAX_DEBUG_BYTES else None)
                row["contact_debug"] = classify_debug_log(raw)
            else:
                row["contact_debug"] = {"status": "not_instrumented",
                                        "true_count": 0, "false_count": 0}
            rows.append(row)
            # This file is untracked and contains only local synthetic activity.
            debug_path.unlink(missing_ok=True)
        report = {
            "schema_version": 1,
            "scenario": CASE,
            "historic_sha": CASES[CASE]["sha"],
            "mode": "demo_emulator_local_rules_debug_guard_preserved",
            "control_and_debug": rows,
            "all_historic_positive_and_negative_assertions_preserved": True,
            "raw_debug_log_published": False,
            "raw_test_log_published": False,
            "production_writes": 0,
            "authorization_guard_removed": False,
            "root_cause_proven": False,
            "independent_review_completed": False,
            "auto_repair_executed": False,
            "causal_accuracy_pct": None,
        }
        with dest.open("x", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, sort_keys=True, indent=2)
            f.write("\n")
        return report
    finally:
        rules_path.write_text(rules, encoding="utf-8")
        probe_test.unlink(missing_ok=True)
        if not debug_path.is_symlink():
            debug_path.unlink(missing_ok=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--historical", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()
    result = execute(args.historical, args.output)
    orig, debug = result["control_and_debug"]
    print("Guard-preserving Rules debug (QA): control_exit=", orig["exit_code"],
          "debug_exit=", debug["exit_code"],
          "guard_state=", debug["contact_debug"]["status"],
          "causality_unproven=true; production_writes=0")
    if 124 in (orig["exit_code"], debug["exit_code"]):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
