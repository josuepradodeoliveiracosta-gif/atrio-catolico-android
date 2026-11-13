#!/usr/bin/env python3
"""Honest, offline KPI baseline for QA diagnostics; never a merge/deploy gate.

Uses only the already-versioned holdout and the existing evaluation contract.
Coverage of signals is NOT root-cause accuracy, nor automatic repair success.
"""
import argparse
import hashlib
import json
from pathlib import Path

from scripts.ci_diagnostic_evaluation import MAX_BYTES, evaluate

SOURCE = (Path(__file__).resolve().parents[1] / "docs" / "ci" / "datasets"
          / "diagnostics-holdout-v1.json")
SCOPE = "holdout_for_seven_added_rules_not_blind_for_entire_classifier"


def _count(value, label):
    if type(value) is not int or value < 0:
        raise ValueError("contagem invalida: " + label)
    return value


def _percent(numerator, denominator):
    return round(100 * numerator / denominator, 1) if denominator else None


def baseline(evaluation, source_sha256):
    """Fail closed on incoherent data; do not invent denominators or accuracy."""
    if not isinstance(evaluation, dict) or evaluation.get("scope") != SCOPE:
        raise ValueError("escopo de avaliacao desconhecido")
    if (not isinstance(source_sha256, str) or len(source_sha256) != 64
            or any(c not in "0123456789abcdef" for c in source_sha256)):
        raise ValueError("digest da amostra invalido")
    total = _count(evaluation.get("sample_total"), "total")
    failures = _count(evaluation.get("failed_jobs"), "falhas")
    successes = _count(evaluation.get("successful_controls"), "controles")
    reviewed = _count(evaluation.get("human_attested_failed_jobs"), "atestados")
    pending = _count(evaluation.get("human_review_pending_failed_jobs"), "pendentes")
    coverage = evaluation.get("signal_coverage")
    if not isinstance(coverage, dict):
        raise ValueError("cobertura invalida")
    specific = _count(coverage.get("specific"), "especificos")
    generic = _count(coverage.get("generic_only"), "genericos")
    inconclusive = _count(coverage.get("inconclusive"), "inconclusivos")
    denominator = _count(coverage.get("denominator_failed_jobs"), "denominador")
    if (total != failures + successes or failures != denominator
            or failures != specific + generic + inconclusive
            or reviewed + pending != failures
            or evaluation.get("root_cause_precision") is not None
            or evaluation.get("review_attestation_authenticity") != "not_verified_offline"
            or evaluation.get("acceptance") != "not_demonstrated_root_cause_90_percent"):
        raise ValueError("amostra ou evidencia de acuracia inconsistente")
    if not total:
        raise ValueError("amostra vazia")
    return {
        "schema_version": 1,
        "mode": "offline_diagnostic_baseline_no_remote_actions",
        "source_sha256": source_sha256,
        "sample_scope": SCOPE,
        "jobs_total": total,
        "failed_jobs": failures,
        "successful_controls": successes,
        "specific_signal_jobs": specific,
        "generic_only_signal_jobs": generic,
        "inconclusive_failed_jobs": inconclusive,
        "specific_signal_coverage_pct": _percent(specific, failures),
        "any_signal_coverage_pct": _percent(specific + generic, failures),
        "human_attested_failed_jobs": reviewed,
        "human_review_pending_failed_jobs": pending,
        "human_attestation_authenticity": "not_verified_offline",
        "measured_root_cause_accuracy_pct": None,
        "root_cause_accuracy_goal_90_status": "not_demonstrated",
        "measured_automated_remediation_pct": None,
        "automated_remediation_goal_99_status": "not_demonstrated",
        "eligible_remediation_denominator": None,
        "verified_automatic_repairs_numerator": None,
        "manual_one_shot_document_pr_counts_as_general_auto_repair": False,
        "signal_coverage_is_accuracy": False,
        "auto_merge_or_deploy_authorized": False,
        "automated_repairs_executed_by_this_tool": 0,
        "external_requests_performed": 0,
    }


def markdown(result):
    specific = result["specific_signal_coverage_pct"]
    any_signal = result["any_signal_coverage_pct"]
    return "\n".join([
        "# Indicadores de diagnostico — linha de base QA (somente leitura)",
        "",
        "**Amostra:** " + str(result["jobs_total"]) + " jobs; "
        + str(result["failed_jobs"]) + " falhos; "
        + str(result["successful_controls"]) + " controles aprovados.",
        "**Sinais especificos:** " + str(result["specific_signal_jobs"])
        + "/" + str(result["failed_jobs"]) + " (" + str(specific) + "%).",
        "**Qualquer sinal (inclusive generico):** "
        + str(result["specific_signal_jobs"] + result["generic_only_signal_jobs"])
        + "/" + str(result["failed_jobs"]) + " (" + str(any_signal) + "%).",
        "**Inconclusivos:** " + str(result["inconclusive_failed_jobs"]) + "/"
        + str(result["failed_jobs"]) + ".",
        "**Revisoes humanas declaradas:** "
        + str(result["human_attested_failed_jobs"]) + "/"
        + str(result["failed_jobs"])
        + "; autenticidade nao verificada pela ferramenta offline.",
        "",
        "**Acuracia de causa raiz (meta 90%): nao demonstrada.**",
        "**Taxa de autocorrecao (meta 99%): nao aferivel; nao ha denominador "
        + "de procedimentos elegiveis nem numerador de reparos comprovados.**",
        "",
        "Cobertura de sinais nao demonstra classificacao correta nem causa raiz.",
        "A PR documental de homologacao manual nao e prova de autocorrecao geral.",
        "A amostra foi separada para sete regras, nao cega para o classificador inteiro.",
        "Esta ferramenta nao acessa logs, rede, usuarios, producao, backups, "
        + "e nao executa reparos, reruns, merges nem deploys.",
        "",
        "SHA-256 da entrada: `" + result["source_sha256"] + "`.",
        "",
    ])


def generate(manifest_path, json_path, markdown_path):
    source = Path(manifest_path)
    out_json, out_md = Path(json_path), Path(markdown_path)
    if len({source.resolve(), out_json.resolve(), out_md.resolve()}) != 3:
        raise ValueError("destinos nao podem sobrescrever fonte ou uns aos outros")
    if source.stat().st_size > MAX_BYTES:
        raise ValueError("manifesto acima do limite")
    raw = source.read_bytes()
    if len(raw) > MAX_BYTES:
        raise ValueError("manifesto acima do limite")
    evidence = evaluate(json.loads(raw.decode("utf-8")))
    result = baseline(evidence, hashlib.sha256(raw).hexdigest())
    # Validate entire content before producing any output files.
    js = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    md = markdown(result)
    out_json.write_text(js, encoding="utf-8")
    out_md.write_text(md, encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default=str(SOURCE))
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    result = generate(args.manifest, args.json, args.markdown)
    print("Baseline QA: " + str(result["failed_jobs"])
          + " falhas; acuracia causal e autocorrecao nao demonstradas")


if __name__ == "__main__":
    main()
