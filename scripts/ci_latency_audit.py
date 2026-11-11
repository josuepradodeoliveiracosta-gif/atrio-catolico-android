#!/usr/bin/env python3
"""Auditoria reproduzivel, somente leitura, das filas e duracoes do GitHub Actions."""
import argparse
from datetime import datetime
import json
import math
import os
from pathlib import Path
import re
from statistics import median
from urllib.request import Request, urlopen

REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
API_ROOT = "https://api.github.com/repos/" + REPO
GROUPS = (
    ("CodeQL / PR", "pull_request",
     "Revisão automática - CodeQL (Kotlin, JS, Python e Actions)"),
    ("Android + Firestore / PR", "pull_request", "Validar selos (Android e Firestore)"),
    ("APK debug / main", "push", "Gerar APK do Atrio Catolico"),
    ("CodeQL / main", "push",
     "Revisão automática - CodeQL (Kotlin, JS, Python e Actions)"),
)
MAX_LIMIT = 20
MAX_JOBS = 100


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("timestamp ausente")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("timestamp invalido") from exc
    if dt.tzinfo is None:
        raise ValueError("timestamp sem timezone")
    return dt


def seconds(start, end):
    diff = (timestamp(end) - timestamp(start)).total_seconds()
    if not 0 <= diff <= 86400:
        raise ValueError("intervalo invalido")
    return round(diff)


def profile(run, jobs):
    if run.get("conclusion") != "success" or not isinstance(jobs, list):
        raise ValueError("run nao confirmado")
    run_id = run.get("id")
    if type(run_id) is not int or run_id < 1 or len(jobs) > MAX_JOBS:
        raise ValueError("run id ou jobs invalidos")
    started = run.get("run_started_at")
    wall = seconds(started, run.get("updated_at"))
    valid = []
    for job in jobs:
        if job.get("conclusion") == "skipped":
            continue
        if job.get("conclusion") != "success":
            raise ValueError("job nao aprovado")
        start = job.get("started_at")
        end = job.get("completed_at")
        elapsed = seconds(start, end)
        wait = seconds(started, start)
        valid.append({
            "name": job.get("name") or "job",
            "elapsed_sec": elapsed,
            "wait_to_start_sec": wait,
            "ended": timestamp(end),
        })
    if not valid:
        raise ValueError("nenhum job executado")
    critical = max(valid, key=lambda j: j["ended"])
    return {
        "run_id": run_id,
        "wall_sec": wall,
        "runner_seconds": sum(job["elapsed_sec"] for job in valid),
        "critical_job": str(critical["name"])[:120],
        "critical_job_seconds": critical["elapsed_sec"],
        "critical_job_wait_to_start_sec": critical["wait_to_start_sec"],
        "note": "espera inclui dependencias e fila; nao prova apenas indisponibilidade de runners",
    }


def percentile_nearest(values, percent):
    if not values or not 0 < percent <= 100:
        raise ValueError("percentil invalido")
    data = sorted(values)
    return data[math.ceil(len(data) * percent / 100) - 1]


def summarize(profiles):
    if not profiles:
        return {"count": 0, "incomplete": True}
    return {
        "count": len(profiles),
        "wall_median_sec": median(p["wall_sec"] for p in profiles),
        "wall_p90_sec": percentile_nearest([p["wall_sec"] for p in profiles], 90),
        "critical_wait_median_sec": median(
            p["critical_job_wait_to_start_sec"] for p in profiles
        ),
        "critical_wait_p90_sec": percentile_nearest(
            [p["critical_job_wait_to_start_sec"] for p in profiles], 90
        ),
        "runner_seconds_median": median(p["runner_seconds"] for p in profiles),
        "incomplete": False,
    }


def get_json(path, token, opener=urlopen):
    if not token:
        raise ValueError("token GitHub de leitura ausente")
    if not re.fullmatch(
        r"actions/(?:runs\?(?:event=pull_request|event=push&branch=main)&per_page=100"
        r"|runs/[1-9][0-9]*/jobs\?per_page=100)", path
    ):
        raise ValueError("endpoint nao permitido")
    request = Request(API_ROOT + "/" + path, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with opener(request, timeout=20) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise ValueError("API retornou objeto invalido")
    return payload


def collect(token, limit=15, fetcher=get_json):
    if type(limit) is not int or not 1 <= limit <= MAX_LIMIT:
        raise ValueError("limite invalido")
    event_runs = {}
    for event, path in (
        ("pull_request", "actions/runs?event=pull_request&per_page=100"),
        ("push", "actions/runs?event=push&branch=main&per_page=100"),
    ):
        payload = fetcher(path, token)
        rows = payload.get("workflow_runs")
        if not isinstance(rows, list):
            raise ValueError("API sem lista de workflow runs")
        event_runs[event] = rows

    report = {"repository": REPO, "mode": "read_only", "limit_per_group": limit,
              "sample_is_not_controlled_experiment": True, "groups": {}}
    cache = {}
    for label, event, workflow in GROUPS:
        candidates = [
            run for run in event_runs[event]
            if run.get("event") == event and run.get("name") == workflow
            and run.get("conclusion") == "success"
            and (event != "push" or run.get("head_branch") == "main")
        ][:limit]
        profiles = []
        for run in candidates:
            rid = run.get("id")
            if type(rid) is not int or rid < 1:
                raise ValueError("id invalido no API")
            if rid not in cache:
                payload = fetcher(f"actions/runs/{rid}/jobs?per_page=100", token)
                if payload.get("total_count", 0) > MAX_JOBS:
                    raise ValueError("paginacao incompleta de jobs")
                jobs = payload.get("jobs")
                if not isinstance(jobs, list):
                    raise ValueError("API sem jobs")
                cache[rid] = jobs
            profiles.append(profile(run, cache[rid]))
        report["groups"][label] = {
            "workflow_name": workflow,
            "event": event,
            "statistics": summarize(profiles),
            "profiles": profiles,
        }
    return report


def escape_cell(value):
    return (str(value).replace("|", r"\|").replace("<", "&lt;")
            .replace(">", "&gt;").replace("\n", " ").replace("\r", " "))


def markdown(report):
    out = [
        "# Auditoria de latência do GitHub Actions", "",
        "Medição somente leitura de workflows bem-sucedidos. Não é experimento "
        "controlado nem estimativa de custo faturável.", "",
        "| Grupo | Amostra | Mediana total | P90 total | Mediana espera job crítico | P90 espera |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for label, group in report["groups"].items():
        s = group["statistics"]
        if s["incomplete"]:
            out.append(f"| {escape_cell(label)} | 0 | — | — | — | — |")
            continue
        out.append(
            f"| {escape_cell(label)} | {s['count']} | {s['wall_median_sec']}s "
            f"| {s['wall_p90_sec']}s | {s['critical_wait_median_sec']}s "
            f"| {s['critical_wait_p90_sec']}s |"
        )
    out.extend(("", "Espera até iniciar o job crítico inclui **dependências** "
                "e **fila**; não mede exclusivamente indisponibilidade de runners.",
                "A soma de segundos dos jobs não corresponde necessariamente a "
                "minutos cobrados. Comparar PRs de escopo semelhante antes de "
                "atribuir ganhos à configuração.", "", "## Evidências por grupo", ""))
    for label, group in report["groups"].items():
        out.append("### " + escape_cell(label))
        for p in group["profiles"]:
            url = f"https://github.com/{REPO}/actions/runs/{p['run_id']}"
            out.append(
                f"- [Run {p['run_id']}]({url}): {p['wall_sec']}s total, "
                f"{p['critical_job_wait_to_start_sec']}s até iniciar "
                f"o job crítico, {p['critical_job_seconds']}s no job crítico."
            )
        out.append("")
    return "\n".join(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    parser.add_argument("--limit", type=int, default=15)
    args = parser.parse_args()
    report = collect(os.environ.get("GITHUB_TOKEN", ""), limit=args.limit)
    Path(args.json).write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    Path(args.markdown).write_text(markdown(report) + "\n", encoding="utf-8")
    print("Auditoria read-only concluida; grupos:", len(report["groups"]))


if __name__ == "__main__":
    main()
