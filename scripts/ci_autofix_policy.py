#!/usr/bin/env python3
"""Conservative, offline remediation policy extending the existing CI diagnostics.

Stage 1 produces a bounded *proposal plan*, not patches or executed repairs.
Do not add GitHub credentials, subprocess calls, external APIs, or production
operations here. Logs and user-controlled text never enter the output.
"""
import argparse
import json
from pathlib import Path

from scripts.ci_quality_report import REPO, validate_sha
from scripts.ci_failure_classifier import MAX_LOG_BYTES, RULES, WEAK_RULES
from scripts.ci_log_safe_analysis import (
    MAX_ANALYZED_JOBS, validate_identity,
)

SECTION = "## Plano de autocorrecao segura (somente proposta)"
MAX_INPUT_BYTES = 250_000
KNOWN_SIGNALS = frozenset(rule[0] for rule in RULES + WEAK_RULES)

# Fixed IDs only; no commands, executable recipes, paths or URLs are accepted.
# A proposal is NOT permission to change a file, rerun a job, or merge a PR.
QA_PROPOSALS = {
    "android_adb_offline": "qa_emulator_health_review",
    "sqlite_closed_database": "qa_sqlite_lifecycle_review",
    "qa_rules_baseline_assertion": "qa_rules_fixture_review",
    "qa_mock_sha_assertion": "qa_mock_contract_review",
}
REVIEW_ONLY = {
    "android_compose_timeout", "ci_contract_mismatch",
    "kotlin_unresolved_reference", "github_dependency_review_unavailable",
    "ci_check_pagination_guard", "qa_evidence_readiness_mismatch",
    "qa_firestore_open_grant_contract", "qa_case_id_contract",
    "qa_ota_tampered_download_test", "generic_compilation_failure",
    "generic_test_assertion",
}
assert set(QA_PROPOSALS).isdisjoint(REVIEW_ONLY)
assert set(QA_PROPOSALS) | REVIEW_ONLY == KNOWN_SIGNALS

UNCLASSIFIED = {
    "identity_not_verified", "limit_reached", "log_unavailable",
}


def _validate_sources(snapshot, identity, signals):
    """Require matching SHA, bounded data, and independently verified jobs."""
    sha, candidates, verified = validate_identity(snapshot, identity)
    if (not isinstance(signals, dict)
            or signals.get("repository") != REPO
            or signals.get("commit_sha") != sha
            or signals.get("mode") != "read_only_bounded_log_signal_analysis"
            or signals.get("raw_log_text_in_artifacts") is not False
            or signals.get("root_cause_established") is not False
            or signals.get("pr_head_freshness") != "not_verified"
            or type(signals.get("max_jobs_per_report")) is not int
            or signals["max_jobs_per_report"] != MAX_ANALYZED_JOBS
            or type(signals.get("max_log_bytes_per_job")) is not int
            or signals["max_log_bytes_per_job"] != MAX_LOG_BYTES):
        raise ValueError("analise nao confiavel ou nao limitada")
    for field in ("automatic_repairs", "automatic_reruns",
                  "automatic_merges_or_deploys"):
        if type(signals.get(field)) is not int or signals[field] != 0:
            raise ValueError("analise indica operacao de escrita")
    rows = signals.get("results")
    if not isinstance(rows, list) or len(rows) != len(candidates):
        raise ValueError("resultados de sinais divergem da fila verificada")
    if type(signals.get("jobs_classified")) is not int:
        raise ValueError("contagem de classificacao invalida")
    if (type(snapshot.get("all_required_success")) is not bool
            or not isinstance(snapshot.get("required_blocking"), list)
            or any(not isinstance(x, dict) or
                   not isinstance(x.get("name"), str) or
                   x.get("state") not in ("missing", "pending", "not-success")
                   for x in snapshot["required_blocking"])
            or snapshot["all_required_success"] == bool(snapshot["required_blocking"])):
        raise ValueError("gates obrigatorios invalidos ou inconsistentes")
    count = 0
    clean = []
    for candidate, row in zip(candidates, rows):
        if (not isinstance(row, dict)
                or any(type(row.get(k)) is not type(candidate[k])
                       or row[k] != candidate[k] for k in
                       ("run_id", "job_id", "state"))):
            raise ValueError("job de sinal nao corresponde a identidade")
        result = row.get("result")
        rule_ids = row.get("signal_ids")
        if (not isinstance(rule_ids, list)
                or len(rule_ids) > len(KNOWN_SIGNALS)
                or any(not isinstance(x, str) or x not in KNOWN_SIGNALS
                       for x in rule_ids)
                or len(rule_ids) != len(set(rule_ids))):
            raise ValueError("IDs de sinais invalidos ou duplicados")
        if result == "classified_in_memory":
            if ((candidate["run_id"], candidate["job_id"]) not in verified
                    or row.get("classification") != (
                        "inconclusive" if not rule_ids else
                        "single_signal_review_needed" if len(rule_ids) == 1 else
                        "multiple_signals_review_needed")):
                raise ValueError("classificacao sem prova de identidade")
            count += 1
        elif (result not in UNCLASSIFIED or rule_ids or
              row.get("classification") != "not_analyzed"):
            raise ValueError("resultado nao classificado com sinais")
        clean.append((candidate, result, rule_ids))
    if signals["jobs_classified"] != count:
        raise ValueError("contagem de jobs classificados divergente")
    return sha, clean, snapshot["required_blocking"]


def build_plan(snapshot, identity, signals):
    """Plan bounded QA investigation without claiming verified root causes."""
    sha, rows, blocked = _validate_sources(snapshot, identity, signals)
    jobs = []
    for candidate, result, rule_ids in rows:
        action = "no_action"
        recipe = "none"
        reason = "no_verified_classification"
        if result == "classified_in_memory":
            if blocked:
                action, reason = "blocked", "required_checks_incomplete"
            elif len(rule_ids) != 1:
                action, reason = "human_review", "ambiguous_or_no_signal"
            elif rule_ids[0] in QA_PROPOSALS:
                action = "qa_proposal_candidate"
                recipe = QA_PROPOSALS[rule_ids[0]]
                reason = "review_qa_only"
            else:
                action, reason = "human_review", "no_approved_recipe"
        jobs.append({
            "run_id": candidate["run_id"], "job_id": candidate["job_id"],
            "signal_ids": sorted(rule_ids),
            "decision": action, "recipe_id": recipe, "reason_id": reason,
            "requires_human_approval_for_write": True,
        })
    return {
        "schema_version": 1,
        "repository": REPO,
        "commit_sha": validate_sha(sha),
        "mode": "plan_only_no_execution",
        "based_on": "ci_log_safe_analysis_verified_job_signals",
        "automation_target_percent": 99,
        "measured_automation_percent": None,
        "root_cause_established": False,
        "freshness_verified_against_current_pr_head": False,
        "required_checks_complete": not bool(blocked),
        "candidate_count": sum(j["decision"] == "qa_proposal_candidate" for j in jobs),
        "jobs": jobs,
        "automatic_repairs_executed": 0,
        "automatic_reruns_executed": 0,
        "automatic_pull_requests_created": 0,
        "automatic_merges_or_deploys": 0,
        "approval_required_before_any_repository_write": True,
        "production_access": False,
        "next_stage": "qa_sandbox_patch_planning_after_review",
    }


def markdown_plan(plan):
    lines = [
        SECTION, "",
        "**Modo:** propostas offline; nenhuma correcao ou PR executada.", "",
        "**SHA:** " + plan["commit_sha"], "",
        "**Meta de automacao:** 99% dos procedimentos elegiveis; "
        + "percentual real ainda nao medido.", "",
        "**Gates obrigatorios completos:** " +
        ("sim" if plan["required_checks_complete"] else "nao"), "",
        "**Propostas QA:** " + str(plan["candidate_count"]), "",
        "| Run | Job | Decisao | Receita segura (ID) |",
        "| ---: | ---: | --- | --- |",
    ]
    for row in plan["jobs"]:
        lines.append("| {} | {} | {} | {} |".format(
            row["run_id"], row["job_id"], row["decision"],
            row["recipe_id"]))
    if not plan["jobs"]:
        lines.append("| — | — | Nenhum job elegivel | — |")
    lines.extend((
        "", "Uma proposta nao prova a causa raiz nem autoriza escrita. "
        "Scripts, commits, PRs, reruns, merge, release e deploy "
        "permanecem desativados nesta etapa.", "",
    ))
    return "\n".join(lines)


def _read_json(path):
    src = Path(path)
    if src.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError("entrada de planejamento acima do limite")
    return json.loads(src.read_text(encoding="utf-8"))


def write_plan(snapshot_path, identity_path, signals_path, json_path, markdown_path):
    snapshot = _read_json(snapshot_path)
    identity = _read_json(identity_path)
    signals = _read_json(signals_path)
    current = Path(markdown_path).read_text(encoding="utf-8")
    if SECTION in current:
        raise ValueError("plano de autocorrecao duplicado")
    plan = build_plan(snapshot, identity, signals)
    rendered = current.rstrip("\n") + "\n\n" + markdown_plan(plan)
    # Prepare both outputs before writing either file.
    document = json.dumps(plan, ensure_ascii=False, indent=2) + "\n"
    Path(json_path).write_text(document, encoding="utf-8")
    Path(markdown_path).write_text(rendered, encoding="utf-8")
    return plan


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--diagnostics", required=True)
    parser.add_argument("--identity", required=True)
    parser.add_argument("--signals", required=True)
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    result = write_plan(args.diagnostics, args.identity, args.signals,
                        args.json, args.markdown)
    print("Autocorrecao em modo plano:", result["candidate_count"],
          "propostas QA; nenhuma modificacao executada")


if __name__ == "__main__":
    main()
