#!/usr/bin/env python3
"""Bounded, read-only GitHub job log signal analysis, never raw log publication.

Only jobs already matched to run/repository/SHA/status/attempt by the separate
identity verifier are eligible. A job log is classified only in memory with
fixed labels. No repairs, reruns, deploys or PR writes are possible.
"""
import argparse
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener

from scripts.ci_quality_report import REPO
from scripts.ci_failure_classifier import MAX_LOG_BYTES, classify
from scripts.ci_log_identity_verifier import (
    API, NoRedirect, validate_queue,
)

MAX_ANALYZED_JOBS = 3
MAX_REDIRECT_URL = 4096
SECTION = "## Sinais de logs verificados (sem dados brutos)"

def approved_signed_url(raw):
    """Allow only HTTPS GitHub Actions log-storage hosts, without credentials."""
    if not isinstance(raw, str) or len(raw) > MAX_REDIRECT_URL:
        return False
    try:
        parsed = urlsplit(raw)
        host = parsed.hostname or ""
        port = parsed.port
    except ValueError:
        return False
    allowed = (host.endswith(".actions.githubusercontent.com")
               or host.endswith(".blob.core.windows.net"))
    return (parsed.scheme == "https" and allowed and parsed.path.startswith("/")
            and port in (None, 443)
            and parsed.username is None and parsed.password is None
            and not parsed.fragment)

def download_job_log(job_id, token, opener=None):
    """GET GitHub 302 with token, then GET approved signed URL *without* token.

    The same no-redirect opener handles both requests. No body is saved to disk.
    The signed location and any exception text are never surfaced in results.
    """
    if type(job_id) is not int or not 0 < job_id < 10 ** 18 or not token:
        raise ValueError("solicitacao invalida")
    if opener is None:
        opener = build_opener(NoRedirect).open
    url = f"{API}/jobs/{job_id}/logs"
    first = Request(url, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with opener(first, timeout=12):
            # A direct body is unexpected; do not accept alternative formats.
            raise ValueError("resposta nao possui link temporario")
    except HTTPError as err:
        if err.code != 302:
            raise ValueError("logs indisponiveis") from None
        signed_url = err.headers.get("Location") if err.headers else None
    if not approved_signed_url(signed_url):
        raise ValueError("destino de logs nao confiavel")
    # Explicitly omit Authorization on the temporary download request.
    second = Request(signed_url, headers={"Accept": "text/plain"})
    with opener(second, timeout=15) as response:
        raw = response.read(MAX_LOG_BYTES + 1)
    if len(raw) > MAX_LOG_BYTES:
        raise ValueError("log acima do limite")
    return raw.decode("utf-8", errors="replace")

def validate_identity(snapshot, identity):
    sha, candidates = validate_queue(snapshot)
    if (not isinstance(identity, dict)
            or identity.get("repository") != REPO
            or identity.get("commit_sha") != sha
            or identity.get("mode") != "read_only_verified_metadata_no_logs"
            or identity.get("raw_logs_accessed") is not False
            or identity.get("raw_logs_published") is not False
            or identity.get("root_cause_established") is not False):
        raise ValueError("prova de identidade invalida")
    results = identity.get("results")
    if (not isinstance(results, list) or len(results) != len(candidates)
            or identity.get("checked_jobs") != len(candidates)):
        raise ValueError("contagem de identidade divergente")
    verified = set()
    for candidate, item in zip(candidates, results):
        if (not isinstance(item, dict)
                or any(item.get(key) != candidate[key]
                       for key in ("run_id", "job_id", "state"))):
            raise ValueError("identificador de identidade divergente")
        expected = item.get("verdict") == "verified"
        if item.get("identity_verified") is not expected:
            raise ValueError("prova contraditoria")
        if expected:
            verified.add((candidate["run_id"], candidate["job_id"]))
    if identity.get("verified_jobs") != len(verified):
        raise ValueError("contagem verificada divergente")
    return sha, candidates, verified

def analyze(snapshot, identity, token, fetch_log=download_job_log):
    sha, candidates, verified = validate_identity(snapshot, identity)
    results = []
    analyzed = 0
    for row in candidates:
        pair = (row["run_id"], row["job_id"])
        entry = {"run_id": row["run_id"], "job_id": row["job_id"],
                 "state": row["state"], "signal_ids": [],
                 "classification": "not_analyzed",
                 "result": "identity_not_verified"}
        if pair in verified:
            if analyzed >= MAX_ANALYZED_JOBS:
                entry["result"] = "limit_reached"
            elif not token:
                entry["result"] = "log_unavailable"
            else:
                analyzed += 1
                try:
                    raw = fetch_log(row["job_id"], token)
                    signal = classify(raw, sha, row["run_id"], row["job_id"],
                                      job_conclusion=row["state"])
                    entry["result"] = "classified_in_memory"
                    entry["classification"] = signal["classification"]
                    entry["signal_ids"] = [flag["rule_id"] for flag in signal["signals"]]
                except (OSError, ValueError, TypeError, UnicodeError):
                    entry["result"] = "log_unavailable"
        results.append(entry)
    return {
        "repository": REPO, "commit_sha": sha,
        "mode": "read_only_bounded_log_signal_analysis",
        "max_jobs_per_report": MAX_ANALYZED_JOBS,
        "max_log_bytes_per_job": MAX_LOG_BYTES,
        "jobs_classified": sum(x["result"] == "classified_in_memory" for x in results),
        "results": results, "raw_log_text_in_artifacts": False,
        "root_cause_established": False, "automatic_repairs": 0,
        "automatic_reruns": 0, "automatic_merges_or_deploys": 0,
        "pr_head_freshness": "not_verified",
    }

def markdown_analysis(result):
    lines = [SECTION, "",
             "**SHA:** `" + result["commit_sha"] + "`", "",
             f"**Jobs analisados:** {result['jobs_classified']}",
             f"**Limite:** {MAX_ANALYZED_JOBS} jobs e {MAX_LOG_BYTES} bytes por job.",
             "", "| Run | Job | Resultado | Sinais (IDs fixos) |",
             "| ---: | ---: | --- | --- |"]
    for item in result["results"]:
        codes = ", ".join(item["signal_ids"]) or "—"
        lines.append(f"| {item['run_id']} | {item['job_id']} | "
                     f"{item['result']} | {codes} |")
    if not result["results"]:
        lines.append("| — | — | Nenhuma falha elegivel neste snapshot | — |")
    lines.extend(("", "Logs foram processados apenas em memoria. "
                  "Nenhuma linha, credencial, URL temporaria ou dado pessoal "
                  "foi copiado para o relatorio. Sinais nao provam causa raiz. "
                  "Sem reruns, reparos, merge ou deploy.", ""))
    return "\n".join(lines)

def write_analysis(snapshot_path, identity_path, output_path, markdown_path, token):
    snapshot = json.loads(Path(snapshot_path).read_text(encoding="utf-8"))
    identity = json.loads(Path(identity_path).read_text(encoding="utf-8"))
    result = analyze(snapshot, identity, token)
    current = Path(markdown_path).read_text(encoding="utf-8")
    if SECTION in current:
        raise ValueError("relatorio de sinais duplicado")
    md = current.rstrip("\n") + "\n\n" + markdown_analysis(result)
    Path(output_path).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    Path(markdown_path).write_text(md, encoding="utf-8")
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--diagnostics", required=True)
    parser.add_argument("--identity", required=True)
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    result = write_analysis(args.diagnostics, args.identity, args.json,
                            args.markdown, os.environ.get("GITHUB_TOKEN"))
    print("Triagem segura:", result["jobs_classified"],
          "jobs; nenhum log bruto publicado")

if __name__ == "__main__":
    main()
