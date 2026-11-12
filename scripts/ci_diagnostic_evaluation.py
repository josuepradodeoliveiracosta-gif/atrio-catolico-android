#!/usr/bin/env python3
"""Offline evidence audit; signal detection is NOT verified root-cause diagnosis."""
import argparse
import json
from pathlib import Path
import re

from scripts.ci_failure_classifier import RULES, WEAK_RULES

REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
SPECIFIC = {r[0] for r in RULES}
GENERIC = {r[0] for r in WEAK_RULES}
VALID_RULES = SPECIFIC | GENERIC
MAX_BYTES = 200_000
ID_RE = re.compile(r"^[a-z0-9_]{3,60}$")
REVIEW_RE = re.compile(
    rf"https://github[.]com/{re.escape(REPO)}/(?:pull|issues)/[0-9]+"
    r"(?:#issuecomment-[0-9]+)?"
)


def _valid_rules(value):
    return (isinstance(value, list)
            and all(isinstance(v, str) and v in VALID_RULES for v in value)
            and len(value) == len(set(value)))


def validate(manifest):
    if (not isinstance(manifest, dict) or set(manifest) !=
            {"schema_version", "repository", "selection", "cases"}
            or type(manifest["schema_version"]) is not int
            or manifest["schema_version"] != 1 or manifest["repository"] != REPO
            or manifest["selection"] != "holdout_for_seven_added_rules_not_blind_for_entire_classifier"):
        raise ValueError("manifest de origem ou versao invalido")
    cases = manifest["cases"]
    if not isinstance(cases, list) or not 0 < len(cases) <= 300:
        raise ValueError("quantidade de casos invalida")
    seen_ids, seen_jobs = set(), set()
    for c in cases:
        if not isinstance(c, dict) or set(c) != {
                "id", "run_id", "job_id", "conclusion", "signal_ids", "review"}:
            raise ValueError("campos adicionais ou logs nao permitidos")
        if not isinstance(c["id"], str) or not ID_RE.fullmatch(c["id"]):
            raise ValueError("identificador de caso invalido")
        if c["id"] in seen_ids:
            raise ValueError("identificador duplicado")
        for field in ("run_id", "job_id"):
            if type(c[field]) is not int or not 0 < c[field] < 10 ** 18:
                raise ValueError("numero de run ou job invalido")
        if c["job_id"] in seen_jobs:
            raise ValueError("job duplicado")
        if c["conclusion"] not in ("failure", "timed_out", "success"):
            raise ValueError("conclusao invalida")
        if not _valid_rules(c["signal_ids"]):
            raise ValueError("sinais incorretos ou duplicados")
        if c["conclusion"] == "success" and c["signal_ids"]:
            raise ValueError("sucesso nao pode incluir incidentes")
        review = c["review"]
        if not isinstance(review, dict) or set(review) != {
                "status", "accepted_signal_ids", "review_reference"}:
            raise ValueError("schema de revisao invalido")
        if review["status"] == "pending":
            if review["accepted_signal_ids"] is not None or review["review_reference"] is not None:
                raise ValueError("revisao ainda pendente")
        elif review["status"] == "human_attested":
            if (not _valid_rules(review["accepted_signal_ids"])
                    or not isinstance(review["review_reference"], str)
                    or not REVIEW_RE.fullmatch(review["review_reference"])):
                raise ValueError("atestacao sem referencia valida")
            if c["conclusion"] == "success" and review["accepted_signal_ids"]:
                raise ValueError("sucesso rotulado como falha")
        else:
            raise ValueError("status de revisao invalido")
        seen_ids.add(c["id"])
        seen_jobs.add(c["job_id"])
    return cases


def evaluate(manifest):
    cases = validate(manifest)
    failures = [x for x in cases if x["conclusion"] != "success"]
    successes = [x for x in cases if x["conclusion"] == "success"]
    specific = sum(bool(SPECIFIC.intersection(x["signal_ids"])) for x in failures)
    generic = sum(bool(x["signal_ids"]) and not SPECIFIC.intersection(x["signal_ids"])
                  for x in failures)
    inconclusive = sum(not x["signal_ids"] for x in failures)
    reviewed = [x for x in failures if x["review"]["status"] == "human_attested"]
    tp = fp = fn = 0
    for c in reviewed:
        predicted = SPECIFIC.intersection(c["signal_ids"])
        accepted = SPECIFIC.intersection(c["review"]["accepted_signal_ids"])
        tp += len(predicted & accepted)
        fp += len(predicted - accepted)
        fn += len(accepted - predicted)
    return {
        "schema_version": 1,
        "scope": manifest["selection"],
        "sample_total": len(cases),
        "failed_jobs": len(failures),
        "successful_controls": len(successes),
        "successful_controls_with_incident": 0,
        "signal_coverage": {
            "specific": specific, "generic_only": generic,
            "inconclusive": inconclusive, "denominator_failed_jobs": len(failures),
        },
        "human_attested_failed_jobs": len(reviewed),
        "human_review_pending_failed_jobs": len(failures) - len(reviewed),
        "adjudicated_signal_counts": {
            "correct_specific": tp, "incorrect_specific": fp,
            "missed_specific": fn,
        },
        "adjudicated_signal_precision": (
            round(tp / (tp + fp), 4) if tp + fp else None
        ),
        "adjudicated_signal_recall": (
            round(tp / (tp + fn), 4) if tp + fn else None
        ),
        "root_cause_precision": None,
        "root_cause_precision_reason": "classifier_does_not_predict_verified_root_causes",
        "review_attestation_authenticity": "not_verified_offline",
        "acceptance": "not_demonstrated_root_cause_90_percent",
        "automated_actions": "none",
        "cases": [{
            "id": x["id"], "run_id": x["run_id"], "job_id": x["job_id"],
            "conclusion": x["conclusion"], "signal_ids": x["signal_ids"],
            "review_status": x["review"]["status"],
        } for x in cases],
    }


def markdown_report(result):
    cov = result["signal_coverage"]
    rows = [
        "# Auditoria offline de diagnosticos", "",
        "**Precisao de causa raiz: nao calculavel. Meta de 90% nao demonstrada.**", "",
        f"Jobs: {result['sample_total']}; falhas: {result['failed_jobs']}; "
        f"controles aprovados: {result['successful_controls']}.", "",
        f"Sinais especificos: {cov['specific']}/{cov['denominator_failed_jobs']}; "
        f"genericos: {cov['generic_only']}/{cov['denominator_failed_jobs']}; "
        f"inconclusivos: {cov['inconclusive']}/{cov['denominator_failed_jobs']}.", "",
        f"Falhas com revisao humana atestada: "
        f"{result['human_attested_failed_jobs']}/{result['failed_jobs']}. "
        "As referencias de revisao nao sao verificadas pela ferramenta offline.", "",
        "| Caso | Job | Sinais | Revisao | Evidencia |",
        "| --- | --- | --- | --- | --- |",
    ]
    for x in result["cases"]:
        url = f"https://github.com/{REPO}/actions/runs/{x['run_id']}"
        labels = ", ".join(x["signal_ids"]) or "nenhum"
        rows.append(
            f"| {x['id']} | {x['conclusion']} | {labels} | "
            f"{x['review_status']} | [Run {x['run_id']}]({url}) |"
        )
    rows.extend(("", "Sem logs brutos, rede, segredos, merge ou deploy.", ""))
    return "\n".join(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    path = Path(args.manifest)
    if path.stat().st_size > MAX_BYTES:
        parser.error("arquivo acima do limite")
    data = json.loads(path.read_text(encoding="utf-8"))
    result = evaluate(data)
    js = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    md = markdown_report(result)
    Path(args.json).write_text(js, encoding="utf-8")
    Path(args.markdown).write_text(md, encoding="utf-8")
    print(f"Auditoria offline: {result['failed_jobs']} falhas; "
          f"{result['human_attested_failed_jobs']} revisadas; "
          "precisao de causa raiz indisponivel")


if __name__ == "__main__":
    main()
