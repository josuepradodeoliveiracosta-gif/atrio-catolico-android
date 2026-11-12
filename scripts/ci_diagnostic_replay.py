#!/usr/bin/env python3
"""Replay fixed, synthetic diagnostic cases; no logs, secrets or network calls.

This checks regression of the offline *classifier*, not reproduces an Android,
Gradle or Firebase production incident. No arbitrary code or shell commands.
"""
import argparse
import json
from pathlib import Path

from scripts.ci_failure_classifier import classify

SYNTHETIC_SHA = "a" * 40
SYNTHETIC_RUN = 1
SYNTHETIC_JOB = 1
# Every case is fictional. Do not insert raw historical logs or real tokens.
CASES = (
    ("kotlin_reference", "failure",
     "> Task :app:compileChatQaKotlin FAILED\n"
     "e: /synthetic.kt:12: Unresolved reference testSymbol\n",
     ("kotlin_unresolved_reference",), "single_signal_review_needed"),
    ("ci_contract", "failure",
     "FAIL: test_existing_safe_caches_kept\n"
     "AssertionError: setup-gradle@v4 not found\n",
     ("ci_contract_mismatch",), "single_signal_review_needed"),
    ("firestore_qa_fixture", "failure",
     "AssertionError: base deve conter regras oficiais substanciais\n",
     ("qa_rules_baseline_assertion",), "single_signal_review_needed"),
    ("firebase_sha_mock", "failure",
     "Error: atrio_rules_deploy_local_sha_mismatch\n"
     "code: ERR_ASSERTION\n",
     ("qa_mock_sha_assertion",), "single_signal_review_needed"),
    ("emulator_multiple_signals", "failure",
     "adb: device offline\n"
     "ComposeTimeoutException: Condition still not satisfied\n",
     ("android_adb_offline", "android_compose_timeout"),
     "multiple_signals_review_needed"),
    ("unknown_exit_code", "failure",
     "##[error]Process completed with exit code 1.\n",
     (), "inconclusive"),
    ("success_with_fixture_failure_text", "success",
     "FAIL: test_existing_safe_caches_kept\n"
     "AssertionError: setup-gradle@v4 not found\n"
     "PASS: test demonstrates error handling\n",
     (), "not_applicable_nonfailed_job"),
    ("uncorroborated_status", "unknown",
     "adb: device offline\n", (), "not_applicable_nonfailed_job"),
    ("distant_markers", "failure",
     "test_existing_safe_caches_kept ... ok\n" +
     "neutral output\n" * 50 +
     "AssertionError: 'gradle/actions/setup-gradle@v4' not found\n",
     ("generic_test_assertion",), "single_signal_review_needed"),
)


def replay(cases=CASES):
    if not cases or len(cases) > len(CASES):
        raise ValueError("quantidade de casos invalida")
    # Only fixed replay cases are supported; never accept untrusted input logs.
    allowed = {row[0]: row for row in CASES}
    seen = set()
    results = []
    for item in cases:
        if not isinstance(item, tuple) or len(item) != 5:
            raise ValueError("fixture invalida")
        name, state, log, expected, expected_status = item
        if name not in allowed or name in seen or item != allowed[name]:
            raise ValueError("fixture desconhecida, repetida ou modificada")
        seen.add(name)
        finding = classify(log, SYNTHETIC_SHA, SYNTHETIC_RUN,
                           SYNTHETIC_JOB, job_conclusion=state)
        observed = tuple(sorted(x["rule_id"] for x in finding["signals"]))
        expected = tuple(sorted(expected))
        status = finding["classification"]
        passed = (observed == expected and status == expected_status and
                  finding["root_cause"] == "not_established" and
                  finding["automated_actions"] == "none")
        results.append({
            "case_id": name,
            "job_conclusion": state,
            "expected_signals": list(expected),
            "observed_signals": list(observed),
            "expected_status": expected_status,
            "observed_status": status,
            "passed": passed,
        })
    return {
        "mode": "deterministic_synthetic_replay_only",
        "version": 1,
        "scope": "classifier_regression_not_android_or_production_reproduction",
        "cases_total": len(results),
        "passed": sum(x["passed"] for x in results),
        "failed": sum(not x["passed"] for x in results),
        "cases": results,
        "root_cause": "not_established",
        "deploy_or_merge": "never",
    }


def render_markdown(report):
    lines = [
        "## Reprodução determinística de diagnósticos — somente QA", "",
        "**Fixtures sintéticas. Não executa aplicativo, emulador ou serviços externos.**", "",
        f"**Casos:** {report['cases_total']} | "
        f"**Aprovados:** {report['passed']} | **Falhas:** {report['failed']}", "",
        "| Cenário | Sinais esperados | Sinais encontrados | Resultado |",
        "| --- | --- | --- | --- |",
    ]
    for case in report["cases"]:
        expected = ", ".join(case["expected_signals"]) or "nenhum"
        actual = ", ".join(case["observed_signals"]) or "nenhum"
        lines.append(f"| {case['case_id']} | {expected} | {actual} | "
                     f"{'APROVADO' if case['passed'] else 'REPROVADO'} |")
    lines.extend(("", "Causa raiz não comprovada. Sem logs reais, rede, "
                  "deploy ou aprovação de merge.", ""))
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", choices=[case[0] for case in CASES])
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    chosen = tuple(case for case in CASES if args.case is None or case[0] == args.case)
    result = replay(chosen)
    # Never publish raw synthetic input text, stack traces or real log content.
    Path(args.json).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    Path(args.markdown).write_text(render_markdown(result), encoding="utf-8")
    print(f"Reprodução offline: {result['passed']}/{result['cases_total']} aprovados")
    if result["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
