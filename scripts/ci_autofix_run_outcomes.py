#!/usr/bin/env python3
"""Read-only audit of known automatic QA workflow runs using GitHub metadata.

Preflight success and a skipped writer are not repairs. Even a successful
writer job is NOT verified evidence that a PR exists or a bug was fixed.
No logs, tokens in output, PR mutations, or conclusions about root cause.
"""
import argparse
import json
import os
from pathlib import Path
from urllib.request import Request, build_opener

from scripts.ci_quality_report import NoRedirect, REPO, validate_sha
from scripts.ci_failure_classifier import positive_int

API = "https://api.github.com/repos/" + REPO + "/actions/runs/"
WORKFLOW = "Autocorrecao QA - PR draft automatica"
PATH = ".github/workflows/autofix-qa-approved-draft.yml"
PREFLIGHT = "Analisar receita QA sem escrita"
WRITER = "Abrir PR draft apenas para receita aprovada"
MAX_RUNS = 12
MAX_JSON_BYTES = 750_000
RECOGNIZED_CONCLUSIONS = {"success", "failure", "cancelled", "timed_out", "skipped"}


def get_json(run_id, token, *, jobs=False, opener=None):
    """Only GET fixed run/job metadata endpoints; never follow redirects."""
    run_id = positive_int(run_id)
    if not isinstance(token, str) or not token or len(token) > 4096:
        raise ValueError("token GitHub de leitura ausente")
    if opener is None:
        opener = build_opener(NoRedirect).open
    endpoint = API + str(run_id) + ("/jobs?per_page=100" if jobs else "")
    req = Request(endpoint, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with opener(req, timeout=15) as response:
        raw = response.read(MAX_JSON_BYTES + 1)
    if len(raw) > MAX_JSON_BYTES:
        raise ValueError("metadados GitHub acima do limite")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("metadados GitHub invalidos")
    return value


def inspect_run(run_id, run, jobs_page):
    """Verify exact run/job binding and classify outcomes without guessing."""
    run_id = positive_int(run_id)
    if not isinstance(run, dict) or not isinstance(jobs_page, dict):
        raise ValueError("estrutura invalida de run/job")
    if (run.get("id") != run_id or run.get("name") != WORKFLOW
            or run.get("path") != PATH or run.get("event") != "workflow_run"
            or run.get("head_branch") != "main"
            or not isinstance(run.get("repository"), dict)
            or run["repository"].get("full_name") != REPO
            or not isinstance(run.get("head_repository"), dict)
            or run["head_repository"].get("full_name") != REPO
            or run.get("status") != "completed"
            or run.get("conclusion") not in RECOGNIZED_CONCLUSIONS
            or type(run.get("run_attempt")) is not int
            or run["run_attempt"] != 1):
        raise ValueError("workflow ou origem nao confiavel")
    sha = validate_sha(run.get("head_sha"))
    jobs = jobs_page.get("jobs")
    if (type(jobs_page.get("total_count")) is not int
            or jobs_page["total_count"] != 2
            or not isinstance(jobs, list) or len(jobs) != 2):
        raise ValueError("jobs ausentes, paginados ou inesperados")
    statuses = {}
    for job in jobs:
        if (not isinstance(job, dict) or job.get("name") not in (PREFLIGHT, WRITER)
                or job["name"] in statuses
                or type(job.get("id")) is not int
                or not 0 < job["id"] < 10 ** 18
                or job.get("run_id") != run_id
                or job.get("head_sha") != sha
                or job.get("run_attempt") != 1
                or job.get("status") != "completed"
                or job.get("conclusion") not in RECOGNIZED_CONCLUSIONS):
            raise ValueError("job nao corresponde ao run original")
        statuses[job["name"]] = job["conclusion"]
    if set(statuses) != {PREFLIGHT, WRITER}:
        raise ValueError("jobs obrigatorios ausentes")
    preflight = statuses[PREFLIGHT]
    writer = statuses[WRITER]
    if preflight != "success" and writer != "skipped":
        raise ValueError("escrita sem preflight aprovado")
    if preflight == "success":
        if writer == "skipped":
            outcome = "writer_not_executed"
        elif writer == "success":
            outcome = "writer_job_success_not_verified_pr_or_fix"
        else:
            outcome = "writer_job_not_successful"
    else:
        outcome = "preflight_did_not_pass"
    # Never infer eligible cases or successful corrections from run metadata.
    return {
        "run_id": run_id, "head_sha": sha,
        "preflight_conclusion": preflight,
        "writer_conclusion": writer,
        "observed_outcome": outcome,
        "run_url": "https://github.com/" + REPO + "/actions/runs/" + str(run_id),
        "verified_eligible_procedure": False,
        "verified_automatic_repair": False,
    }


def audit(run_ids, fetch):
    if (not isinstance(run_ids, list) or not 0 < len(run_ids) <= MAX_RUNS
            or any(type(run_id) is not int or not 0 < run_id < 10 ** 18
                   for run_id in run_ids)
            or len(set(run_ids)) != len(run_ids)):
        raise ValueError("lista de execucoes invalida ou duplicada")
    rows = [inspect_run(run_id, fetch(run_id, False), fetch(run_id, True))
            for run_id in run_ids]
    return {
        "schema_version": 1, "repository": REPO,
        "mode": "verified_github_metadata_read_only_selected_runs",
        "sample_selection": "operator_selected_not_representative",
        "observed_auto_workflow_runs": len(rows),
        "preflight_success": sum(x["preflight_conclusion"] == "success"
                                 for x in rows),
        "writer_skipped": sum(x["writer_conclusion"] == "skipped"
                              for x in rows),
        "writer_job_succeeded": sum(x["writer_conclusion"] == "success"
                                    for x in rows),
        "writer_job_failed_or_cancelled": sum(
            x["writer_conclusion"] in {"failure", "cancelled", "timed_out"}
            for x in rows),
        "eligible_procedures_verified": None,
        "automated_repairs_independently_verified": None,
        "measured_automatic_repair_success_percent": None,
        "root_cause_accuracy_percent": None,
        "manual_workflows_counted": False,
        "writer_success_is_proof_of_fix": False,
        "head_freshness": "historical_sha_not_checked_against_current_main",
        "automatic_retries_or_writes_executed_by_auditor": 0,
        "rows": rows,
    }


def markdown(result):
    return "\n".join([
        "# Auditoria de resultados da autocorrecao QA (metadados)",
        "",
        "**Amostra escolhida pelo operador:** "
        + str(result["observed_auto_workflow_runs"]) + " execucoes.",
        "**Preflights bem-sucedidos:** " + str(result["preflight_success"]) + ".",
        "**Jobs escritores ignorados:** " + str(result["writer_skipped"]) + ".",
        "**Jobs escritores concluidos com sucesso:** "
        + str(result["writer_job_succeeded"])
        + " (nao comprova PR criada ou reparo efetivo).",
        "",
        "| Run | Preflight | Writer | Resultado observado |",
        "| --- | --- | --- | --- |",
        *[
            "| [#" + str(row["run_id"]) + "](" + row["run_url"] + ") | "
            + row["preflight_conclusion"] + " | " + row["writer_conclusion"]
            + " | " + row["observed_outcome"] + " |"
            for row in result["rows"]
        ],
        "",
        "**Taxa de autocorrecao real: nao calculavel.** "
        "Metadados do workflow nao identificam o conjunto de procedimentos "
        "elegiveis nem comprovam correcao efetiva ou aceite dos testes.",
        "Nenhuma execucao manual foi contabilizada. Sem logs, segredos, "
        "causa raiz suposta, alteracao de PR, merge, rerun ou deploy.",
        "",
    ])


def write_report(run_ids, token, json_path, markdown_path, fetcher=get_json):
    if Path(json_path).resolve() == Path(markdown_path).resolve():
        raise ValueError("os destinos devem ser diferentes")
    result = audit(run_ids, lambda run_id, jobs: fetcher(run_id, token, jobs=jobs))
    js = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    md = markdown(result)
    Path(json_path).write_text(js, encoding="utf-8")
    Path(markdown_path).write_text(md, encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", action="append", required=True)
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    # CLI accepts canonical positive decimal IDs; no free-form URL/endpoint.
    run_ids = [positive_int(value) for value in args.run_id]
    result = write_report(run_ids, os.environ.get("GITHUB_TOKEN"),
                          args.json, args.markdown)
    print("Auditoria QA:", result["observed_auto_workflow_runs"],
          "runs; porcentagem de autocorrecao nao aferivel")


if __name__ == "__main__":
    main()
