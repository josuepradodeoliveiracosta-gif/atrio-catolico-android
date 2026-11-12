#!/usr/bin/env python3
"""Verify GitHub Actions job identity from diagnostic metadata, read-only.

No job logs are downloaded. All network URLs are constructed locally, responses
are size bounded, and only fixed verdict codes (never API text) enter artifacts.
A verified job is NOT a verified root cause nor proof the PR HEAD is current.
"""
import argparse
import json
import os
import re
from urllib.request import HTTPRedirectHandler, build_opener
from pathlib import Path
from urllib.request import Request, urlopen

from scripts.ci_quality_report import REPO, validate_sha
from scripts.ci_diagnostic_snapshot import MAX_LOG_JOBS
from scripts.ci_failure_classifier import positive_int

API = "https://api.github.com/repos/" + REPO + "/actions"
MAX_RESPONSE_BYTES = 65536
ALLOWED_STATES = {"failure", "timed_out"}
SECTION = "## Identidade de jobs do CI (somente leitura)"
API_PATH = re.compile(r"/(?:runs|jobs)/[1-9][0-9]{0,17}")

class NoRedirect(HTTPRedirectHandler):
    """Never forward a bearer token to an unexpected redirect."""
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def validate_queue(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("repository") != REPO:
        raise ValueError("diagnostico de repositorio incorreto")
    sha = validate_sha(snapshot.get("commit_sha"))
    queue = snapshot.get("log_review_queue")
    if (not isinstance(queue, dict)
            or queue.get("mode") != "metadata_only_no_log_access"
            or queue.get("automatic_log_download") is not False
            or queue.get("root_cause_established") is not False):
        raise ValueError("fila sem garantias de segurança")
    candidates = queue.get("candidates")
    if not isinstance(candidates, list) or len(candidates) > MAX_LOG_JOBS:
        raise ValueError("fila excede limite ou ausente")
    seen = set()
    clean = []
    for candidate in candidates:
        if not isinstance(candidate, dict) or candidate.get("identity_verified") is not False:
            raise ValueError("candidato nao verificado invalido")
        if type(candidate.get("run_id")) is not int or type(candidate.get("job_id")) is not int:
            raise ValueError("identificador precisa ser inteiro")
        run_id = positive_int(candidate.get("run_id"))
        job_id = positive_int(candidate.get("job_id"))
        state = candidate.get("state")
        if state not in ALLOWED_STATES or (run_id, job_id) in seen:
            raise ValueError("estado ou identificador duplicado")
        seen.add((run_id, job_id))
        clean.append({"run_id": run_id, "job_id": job_id, "state": state})
    return sha, clean

def api_json(path, token, opener=None):
    """Only GET exact metadata endpoints; never redirect with credentials."""
    if not isinstance(path, str) or not API_PATH.fullmatch(path):
        raise ValueError("endpoint de metadados invalido")
    if not token or not isinstance(token, str):
        raise ValueError("token de leitura indisponivel")
    if opener is None:
        opener = build_opener(NoRedirect).open
    request = Request(API + path, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with opener(request, timeout=12) as response:
        payload = response.read(MAX_RESPONSE_BYTES + 1)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise ValueError("resposta de metadados muito grande")
    value = json.loads(payload)
    if not isinstance(value, dict):
        raise ValueError("metadados invalidos")
    return value

def verify_one(run, job, sha, candidate):
    """Check exact run, repository, SHA, job binding and failed conclusion."""
    run_id, job_id, state = candidate["run_id"], candidate["job_id"], candidate["state"]
    if not isinstance(run, dict) or not isinstance(job, dict):
        return "metadata_unavailable"
    repository = run.get("repository")
    head_repository = run.get("head_repository")
    if (not isinstance(repository, dict) or repository.get("full_name") != REPO
            or not isinstance(head_repository, dict)
            or head_repository.get("full_name") != REPO):
        return "rejected_repository"
    if run.get("id") != run_id or run.get("head_sha") != sha:
        return "rejected_run_sha"
    if run.get("status") != "completed":
        return "rejected_run_incomplete"
    if (job.get("id") != job_id or job.get("run_id") != run_id
            or job.get("head_sha") != sha):
        return "rejected_job_identity"
    if job.get("status") != "completed" or job.get("conclusion") != state:
        return "rejected_job_conclusion"
    if state not in ALLOWED_STATES:
        return "rejected_job_conclusion"
    # A stale retry attempt must never be treated as current.
    run_attempt = run.get("run_attempt")
    job_attempt = job.get("run_attempt")
    if type(run_attempt) is not int or run_attempt < 1:
        return "rejected_run_attempt"
    # REST job metadata may omit run_attempt. Only initial attempts are then
    # accepted; retries without explicit evidence are left unverified.
    if job_attempt is None:
        if run_attempt != 1:
            return "rejected_run_attempt"
    elif type(job_attempt) is not int or job_attempt != run_attempt:
        return "rejected_run_attempt"
    return "verified"

def verify(snapshot, token, fetcher=api_json):
    sha, candidates = validate_queue(snapshot)
    run_cache = {}
    results = []
    for candidate in candidates:
        run_id, job_id = candidate["run_id"], candidate["job_id"]
        if not token:
            verdict = "metadata_unavailable"
        else:
            try:
                if run_id not in run_cache:
                    run_cache[run_id] = fetcher(f"/runs/{run_id}", token)
                job = fetcher(f"/jobs/{job_id}", token)
                verdict = verify_one(run_cache[run_id], job, sha, candidate)
            except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
                verdict = "metadata_unavailable"
        results.append({
            "run_id": run_id, "job_id": job_id, "state": candidate["state"],
            "verdict": verdict, "identity_verified": verdict == "verified",
        })
    return {
        "repository": REPO, "commit_sha": sha,
        "mode": "read_only_verified_metadata_no_logs",
        "checked_jobs": len(results),
        "verified_jobs": sum(x["identity_verified"] for x in results),
        "results": results,
        "raw_logs_accessed": False,
        "raw_logs_published": False,
        "root_cause_established": False,
        "actions_executed": "none",
        "freshness": "not_checked_against_current_pr_head",
    }

def markdown_evidence(result):
    lines = [SECTION, "",
             "**SHA:** `" + result["commit_sha"] + "`", "",
             f"**Identidades verificadas:** {result['verified_jobs']}/{result['checked_jobs']}",
             "", "| Run | Job | Resultado de identidade |",
             "| ---: | ---: | --- |"]
    for item in result["results"]:
        lines.append(f"| {item['run_id']} | {item['job_id']} | {item['verdict']} |")
    if not result["results"]:
        lines.append("| — | — | Nenhum job elegivel neste snapshot |")
    lines.extend(("", "Somente metadados; logs nao lidos, causa raiz nao determinada. "
                  "A validacao do SHA nao prova que ele ainda e o HEAD da PR. "
                  "Nao autoriza merge, deploy, rerun ou reparo.", ""))
    return "\n".join(lines)

def write_verified(snapshot_path, output_path, markdown_path, token):
    snapshot = json.loads(Path(snapshot_path).read_text(encoding="utf-8"))
    result = verify(snapshot, token)
    previous = Path(markdown_path).read_text(encoding="utf-8")
    if SECTION in previous:
        raise ValueError("secao de verificacao ja anexada")
    new_md = previous.rstrip("\n") + "\n\n" + markdown_evidence(result)
    Path(output_path).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    Path(markdown_path).write_text(new_md, encoding="utf-8")
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--diagnostics", required=True)
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    result = write_verified(args.diagnostics, args.json, args.markdown,
                            os.environ.get("GITHUB_TOKEN"))
    print("Verificacao de metadados:", result["verified_jobs"],
          "de", result["checked_jobs"], "jobs; nenhum log acessado")

if __name__ == "__main__":
    main()
