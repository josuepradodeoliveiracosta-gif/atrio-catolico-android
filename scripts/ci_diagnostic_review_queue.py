#!/usr/bin/env python3
"""Build a bounded offline human-review queue from the frozen diagnostic holdout.

This module neither establishes root causes nor records human attestations.
All GitHub links are pointers, not proof that remote evidence was verified.
"""
import argparse
import hashlib
import json
from pathlib import Path

from scripts.ci_diagnostic_evaluation import MAX_BYTES, REPO, validate

SOURCE = (Path(__file__).resolve().parents[1] / "docs" / "ci" / "datasets"
          / "diagnostics-holdout-v1.json")
MAX_CASES = 300


def _read_bounded(path):
    source = Path(path)
    if not source.is_file() or source.stat().st_size > MAX_BYTES:
        raise ValueError("manifesto QA ausente ou grande demais")
    content = source.read_bytes()
    if len(content) > MAX_BYTES:
        raise ValueError("manifesto QA grande demais")
    return content


def build_review_queue(raw, pinned_raw):
    """Produce tasks, not verdicts; reject any mutated or re-labelled holdout."""
    if not isinstance(raw, bytes) or not isinstance(pinned_raw, bytes):
        raise ValueError("amostra precisa ser bytes do arquivo original")
    if raw != pinned_raw or not 0 < len(raw) <= MAX_BYTES:
        raise ValueError("amostra divergente da fonte congelada")
    manifest = json.loads(raw.decode("utf-8"))
    cases = validate(manifest)
    if len(cases) > MAX_CASES:
        raise ValueError("amostra acima do limite")
    if any(x["review"]["status"] != "pending" for x in cases):
        raise ValueError("fila de revisao nao pode substituir atestacao humana")
    failed = [x for x in cases if x["conclusion"] in ("failure", "timed_out")]
    controls = [x for x in cases if x["conclusion"] == "success"]
    tasks = []
    for case in failed:
        run = case["run_id"]
        job = case["job_id"]
        tasks.append({
            "id": case["id"],
            "run_id": run,
            "job_id": job,
            "job_conclusion_from_manifest": case["conclusion"],
            "observed_signal_ids_from_manifest": list(case["signal_ids"]),
            "run_url_for_manual_review": (
                f"https://github.com/{REPO}/actions/runs/{run}"
            ),
            "job_url_for_manual_review": (
                f"https://github.com/{REPO}/actions/runs/{run}/job/{job}"
            ),
            "source_job_identity_verified_live": False,
            "review_status": "pending_independent_human_review",
            "confirmed_root_cause": None,
            "root_cause_prediction_by_classifier": None,
            "independent_review_reference": None,
            "successful_automatic_fix_verified": False,
            "can_be_counted_in_90_percent_metric": False,
            "can_be_counted_in_99_percent_metric": False,
        })
    return {
        "schema_version": 1,
        "repository": REPO,
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "mode": "offline_review_queue_without_adjudication",
        "sampling_scope": manifest["selection"],
        "sample_is_representative_for_entire_classifier": False,
        "source_job_identity_verified_live": False,
        "total_cases": len(cases),
        "failed_jobs_needing_review": len(failed),
        "successful_control_jobs_not_incidents": len(controls),
        "pending_independent_reviews": len(tasks),
        "reviewed_causal_cases_verified": 0,
        "measured_root_cause_accuracy_pct": None,
        "measured_automatic_fix_success_pct": None,
        "root_cause_goal_90_demonstrated": False,
        "automatic_fix_goal_99_demonstrated": False,
        "proposals_and_green_checks_count_as_repairs": False,
        "automatic_actions_executed": 0,
        "network_requests_performed": 0,
        "review_tasks": tasks,
    }


def markdown(result):
    lines = [
        "# Fila QA para verificacao humana de causas (somente leitura)",
        "",
        f"Amostra: {result['total_cases']} jobs; "
        f"{result['failed_jobs_needing_review']} falhas para revisao; "
        f"{result['successful_control_jobs_not_incidents']} controles de sucesso.",
        "**Todas as causas permanecem pendentes de revisao humana independente.**",
        "**Meta causal de 90%: nao demonstrada; meta de autocorrecao de 99%: nao demonstrada.**",
        "Esses jobs nao constituem uma amostra cega do classificador inteiro.",
        "Links de GitHub sao referencias de trabalho, nao evidencia remota verificada.",
        "",
        "| Caso | Sinais existentes | Revisar job | Situacao |",
        "| --- | --- | --- | --- |",
    ]
    for task in result["review_tasks"]:
        signals = ", ".join(task["observed_signal_ids_from_manifest"]) or "nenhum"
        lines.append(
            f"| {task['id']} | {signals} | "
            f"[Job {task['job_id']}]({task['job_url_for_manual_review']}) | pendente |"
        )
    lines.extend([
        "",
        "## Exigencias antes de registrar um diagnostico de causa",
        "",
        "1. Conferir manualmente identidade do run/job, SHA e conclusao diretamente no GitHub.",
        "2. Identificar e confirmar a causa por evidencias verificaveis e revisao independente.",
        "3. Registrar somente uma referencia de revisao sem logs privados, credenciais ou dados pessoais.",
        "4. Separar sinal observado, causa confirmada, elegibilidade para reparo e reparo executado.",
        "5. Manter casos inconclusivos como inconclusivos; nao inferir acerto ou porcentagens.",
        "",
        f"SHA-256 da fonte: `{result['source_sha256']}`.",
        "Nenhuma acao remota, reparo, token, merge ou deploy foi executado.",
        "",
    ])
    return "\n".join(lines)


def generate(manifest_path, json_path, markdown_path):
    source, js_dest, md_dest = map(
        lambda p: Path(p).resolve(),
        (manifest_path, json_path, markdown_path))
    if len({source, js_dest, md_dest}) != 3:
        raise ValueError("origem e destinos devem ser distintos")
    if js_dest.exists() or md_dest.exists():
        raise ValueError("nao sobrescrever arquivos existentes")
    raw = _read_bounded(source)
    pinned_raw = _read_bounded(SOURCE)
    result = build_review_queue(raw, pinned_raw)
    js = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    md = markdown(result)
    js_dest.write_text(js, encoding="utf-8")
    md_dest.write_text(md, encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default=str(SOURCE))
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    result = generate(args.manifest, args.json, args.markdown)
    print(f"Fila QA: {result['pending_independent_reviews']} falhas "
          "aguardam revisao humana; nenhuma causa confirmada.")


if __name__ == "__main__":
    main()
