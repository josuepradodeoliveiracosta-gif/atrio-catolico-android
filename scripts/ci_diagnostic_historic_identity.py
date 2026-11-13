#!/usr/bin/env python3
"""Verify historic failed-job identities, read-only, without deciding root causes.

Reuses the existing bounded GitHub metadata GET and job verifier. Source
signals remain unverified; no raw logs, credentials, fixes, or reviews.
"""
import argparse
import json
import os
from pathlib import Path

from scripts.ci_diagnostic_review_queue import SOURCE, _read_bounded, build_review_queue
from scripts.ci_log_identity_verifier import api_json, verify_one
from scripts.ci_quality_report import REPO, validate_sha

MAX_CANDIDATES = 20


def verify_historic_failures(raw, pinned_raw, token=None, fetcher=api_json):
    """Return only bounded verdict codes, never API messages or causal claims."""
    queue = build_review_queue(raw, pinned_raw)
    cases = queue["review_tasks"]
    if not 0 < len(cases) <= MAX_CANDIDATES:
        raise ValueError("quantidade de falhas fora do limite da auditoria")
    if token is not None and (
            not isinstance(token, str) or not 0 < len(token) <= 4096):
        raise ValueError("credencial de leitura invalida")
    rows = []
    for case in cases:
        run_id, job_id = case["run_id"], case["job_id"]
        sha = None
        if not token:
            verdict = "not_verified_no_read_token"
        else:
            try:
                # Fixed endpoints; api_json rejects redirects, arbitrary URLs,
                # oversized responses and non-GitHub targets.
                run = fetcher(f"/runs/{run_id}", token)
                job = fetcher(f"/jobs/{job_id}", token)
                sha = validate_sha(run.get("head_sha"))
                verdict = verify_one(run, job, sha, {
                    "run_id": run_id, "job_id": job_id,
                    "state": case["job_conclusion_from_manifest"],
                })
            except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
                verdict = "metadata_unavailable"
                sha = None
        if verdict != "verified":
            sha = None
        rows.append({
            "case_id": case["id"],
            "run_id": run_id,
            "job_id": job_id,
            "expected_conclusion": case["job_conclusion_from_manifest"],
            "verified_head_sha": sha,
            "verdict": verdict,
            "job_identity_verified": verdict == "verified",
            "source_signal_independently_verified": False,
            "root_cause_established": False,
            "review_adjudication_completed": False,
            "repair_performed_or_verified": False,
        })
    return {
        "schema_version": 1,
        "repository": REPO,
        "mode": "metadata_identity_only_no_logs",
        "source_sha256": queue["source_sha256"],
        "selection": queue["sampling_scope"],
        "sample_representative": False,
        "failed_jobs_in_frozen_holdout": len(rows),
        "identities_verified": sum(row["job_identity_verified"] for row in rows),
        "causes_human_adjudicated": 0,
        "measured_root_cause_accuracy_pct": None,
        "measured_eligible_auto_repair_pct": None,
        "target_causal_accuracy_90_demonstrated": False,
        "target_automated_remediation_99_demonstrated": False,
        "human_review_substituted": False,
        "logs_or_private_evidence_accessed": False,
        "writes_or_reruns_executed": 0,
        "rows": rows,
    }


def markdown(result):
    lines = [
        "# Conferencia de identidade da amostra historica (metadados)",
        "",
        f"**Jobs com falha verificados:** {result['identities_verified']}/"
        f"{result['failed_jobs_in_frozen_holdout']}.",
        "**Causas raiz revisadas:** 0. Meta de 90% nao demonstrada.",
        "**Taxa de reparo elegivel:** nao aferida. Meta de 99% nao demonstrada.",
        "A identidade confirmada e o SHA do run nao verificam causa ou sinais no log.",
        "Esta amostra nao e representativa do classificador inteiro.",
        "",
        "| Caso | Run | Job | Identidade |",
        "| --- | ---: | ---: | --- |",
    ]
    for row in result["rows"]:
        lines.append(
            f"| {row['case_id']} | {row['run_id']} | {row['job_id']} | "
            f"{row['verdict']} |"
        )
    lines.extend((
        "",
        f"SHA-256 da amostra: `{result['source_sha256']}`.",
        "Nenhum log acessado, revisao humana realizada, merge, deploy ou correcao.",
        "",
    ))
    return "\n".join(lines)


def generate(manifest_path, json_path, markdown_path, token, fetcher=api_json):
    inp, out_json, out_md = [Path(p).resolve() for p in (
        manifest_path, json_path, markdown_path)]
    if (len({inp, out_json, out_md}) != 3
            or SOURCE.resolve() in {out_json, out_md}):
        raise ValueError("arquivos de entrada e saida sobrepostos")
    if out_json.exists() or out_md.exists():
        raise ValueError("nao sobrescrever relatorios existentes")
    raw = _read_bounded(inp)
    pinned = _read_bounded(SOURCE)
    result = verify_historic_failures(raw, pinned, token, fetcher)
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    displayed = markdown(result)
    out_json.write_text(encoded, encoding="utf-8")
    out_md.write_text(displayed, encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default=str(SOURCE))
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    result = generate(args.manifest, args.json, args.markdown,
                      os.environ.get("GITHUB_TOKEN"))
    print("Identidades verificadas:", result["identities_verified"], "/",
          result["failed_jobs_in_frozen_holdout"], "; nenhuma causa confirmada")


if __name__ == "__main__":
    main()
