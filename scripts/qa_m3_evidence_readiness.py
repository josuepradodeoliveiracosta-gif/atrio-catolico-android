#!/usr/bin/env python3
"""Inventário read-only de evidências QA, não um autorizador de implantação.

Consulta apenas GETs fixos na API do GitHub; compara SHA e resultado do
workflow de cada PR independente. Nunca aprova política, merge ou deploy.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
PARENT_BRANCH = "feat/atrio-conversas-etapa1-20261106"
PARENT_SHA = "530395026d0dc37ac424b788c3f5a22f79bb8fed"
MAIN_SHA = "d44df3759ba841933cd786cb7f13f6487e8d2b17"
CHECKS = (
    (218, "d65c80a7f696d46f64b1149ccd560b5d8ce4fe57", 42901838114,
     "QA chat 18+ - durabilidade e concorrencia (laboratorio isolado)"),
    (219, "b10a7625a56d7045caeb947a1fcb8ef5b8ba21dc", 42906141484,
     "QA Firestore - auditoria de collectionGroup e convites (offline)"),
    (220, "2cf4ff01fa63a9858c9801950a3e00c35de594e9", 42909043973,
     "QA Firestore - preflight NO-GO do marco 3 (read only)"),
    (221, "a66f8661675a915368113bd85b82152af35fe448", 42909923020,
     "QA Moderacao - protecao de denuncias e revogacao de papeis (offline)"),
    (222, "e6ec64c4809e86c0f317b86c4df98536a1bdac75", 42910907648,
     "QA Retencao - inventario de evidencias sem exclusao"),
    (223, "d416ad4bdb59fb40816ebde7f84e8ef548486fd9", 42912157770,
     "QA Politica 200 - validar registro pendente sem aprovar implantacao"),
    (224, "5b347305261c4d025a4a2ebdaf9405283b006937", 42913256841,
     "QA Incidentes - triagem e recursos somente simulados"),
    (225, "3fd6fa8ac7eaf8ee8c7a1560a5326331c68e3661", 42913654069,
     "QA Direitos - solicitacoes e impedimentos sem exclusao"),
)
URL_PREFIX = "https://api.github.com/repos/" + REPO


def fixed_paths():
    return (
        ["/branches/main", "/pulls/193", "/issues/200"]
        + ["/pulls/" + str(number) for number, _, _, _ in CHECKS]
        + ["/actions/runs/" + str(run_id) for _, _, run_id, _ in CHECKS]
    )


def collect(fetch_json):
    """Somente 19 GETs em caminhos estáticos, sem varrer usuários ou dados."""
    return {path: fetch_json(URL_PREFIX + path) for path in fixed_paths()}


def summarize(sources):
    problems = []
    evidence = []
    if not isinstance(sources, dict):
        sources = {}
    def item(path):
        value = sources.get(path)
        return value if isinstance(value, dict) else {}
    current_main = item("/branches/main").get("commit", {}).get("sha")
    if current_main != MAIN_SHA:
        problems.append("MAIN_SHA_REVIEW_REQUIRED")
    parent = item("/pulls/193")
    if not (parent.get("number") == 193
            and parent.get("state") == "open"
            and parent.get("draft") is True
            and parent.get("head", {}).get("sha") == PARENT_SHA
            and parent.get("head", {}).get("ref") == PARENT_BRANCH
            and parent.get("base", {}).get("ref") == "main"):
        problems.append("PARENT_PR_193_MOVED_OR_NOT_DRAFT")
    issue = item("/issues/200")
    state = issue.get("state") if issue.get("number") == 200 else None
    if state != "open":
        problems.append("POLICY_ISSUE_200_NOT_CONFIRMED_OPEN")
    for number, sha, run_id, name in CHECKS:
        pr = item("/pulls/" + str(number))
        run = item("/actions/runs/" + str(run_id))
        pr_good = (
            pr.get("number") == number
            and pr.get("state") == "open"
            and pr.get("draft") is True
            and pr.get("head", {}).get("sha") == sha
            and pr.get("head", {}).get("repo", {}).get("full_name") == REPO
            and pr.get("base", {}).get("ref") == PARENT_BRANCH
        )
        ci_good = (
            run.get("id") == run_id
            and run.get("name") == name
            and run.get("event") == "pull_request"
            and run.get("status") == "completed"
            and run.get("conclusion") == "success"
            and run.get("head_sha") == sha
            and run.get("repository", {}).get("full_name") == REPO
        )
        if not pr_good:
            problems.append("PR_STATE_OR_SHA_MISMATCH:" + str(number))
        if not ci_good:
            problems.append("CI_NOT_VALID_FOR_PR:" + str(number))
        evidence.append({
            "pr": number, "runId": run_id, "headMatchesPinned": pr_good,
            "workflowMatchesPinned": ci_good,
            "safeForEvidenceReview": pr_good and ci_good,
        })
    ready = not problems
    return {
        "report": "atrio_qa_milestone3_evidence_inventory",
        "scope": "GITHUB_METADATA_READ_ONLY",
        "status": "NO_GO",
        "evidenceState": "READY_FOR_HUMAN_REVIEW" if ready
                         else "EVIDENCE_INCOMPLETE",
        "issue200State": state if state in ("open", "closed") else "unknown",
        "checkedDraftPRs": len(CHECKS),
        "validatedDraftPRs": sum(int(x["safeForEvidenceReview"]) for x in evidence),
        "completedMilestones": 2,
        "totalMilestones": 7,
        "qaDeployAuthorized": False,
        "prodDeployAuthorized": False,
        "mergeAuthorized": False,
        "ageProofReal": False,
        "policyApproved": False,
        "deletedCount": 0,
        "evidence": evidence,
        "problems": problems,
        "blockers": [
            "ISSUE_200_HUMAN_POLICY_AND_PRIVACY_REVIEW_REQUIRED",
            "REAL_18_PLUS_VERIFIER_NOT_HOMOLOGATED",
            "QA_CLOUD_DEPLOY_AND_ROLLBACK_NOT_APPROVED",
            "NO_HUMAN_APPROVAL_TO_MERGE_OR_PUBLISH",
        ],
        "note": "CI and metadata prove only reviewed SHAs; never GO or deploy.",
    }


def live_get(url):
    if url not in {URL_PREFIX + p for p in fixed_paths()}:
        raise ValueError("Non-whitelisted GET")
    token = os.environ.get("GITHUB_TOKEN", "")
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "atrio-qa-evidence-readonly",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = "Bearer " + token
    request = Request(url, headers=headers, method="GET")
    with urlopen(request, timeout=20) as response:
        raw = response.read(150001)
    if len(raw) > 150000:
        raise ValueError("Oversized API response")
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError("Unexpected API response")
    return result


def markdown(report):
    lines = [
        "## Evidências das PRs QA #218–#225 — somente leitura",
        "",
        "**NO-GO:** não aprova política, integração ou deploy.",
        "- Estado das evidências: " + report["evidenceState"],
        "- PRs conferidas: " + str(report["checkedDraftPRs"]),
        "- PRs com CI vinculada ao SHA: " + str(report["validatedDraftPRs"]),
        "- Issue #200: " + report["issue200State"],
        "- Marco QA: 2/7 (29%)",
        "",
        "### Confronto de metadados",
        "",
    ]
    for e in report["evidence"]:
        lines.append(
            "- PR #" + str(e["pr"]) + ": " +
            ("SHA/CI conferidos" if e["safeForEvidenceReview"] else
             "revisão de evidências necessária") +
            " (workflow #" + str(e["runId"]) + ")"
        )
    lines.extend(["", "### Bloqueios de liberação", ""])
    lines.extend("- " + s for s in report["blockers"])
    if report["problems"]:
        lines.extend(["", "### Inconsistências da evidência", ""])
        lines.extend("- " + s for s in report["problems"])
    lines.extend(["", "Sem credenciais, mensagens ou dados privados no relatório.", ""])
    return "\n".join(lines)


def main():
    if len(os.sys.argv) != 1:
        raise SystemExit("Usage: python3 scripts/qa_m3_evidence_readiness.py")
    # Falha ao ler GitHub é erro de CI; nunca equiparar indisponível a success.
    source = collect(live_get)
    report = summarize(source)
    tmp = Path(os.environ.get("RUNNER_TEMP", "/tmp"))
    (tmp / "qa-m3-evidence-no-go.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (tmp / "qa-m3-evidence-no-go.md").write_text(
        markdown(report), encoding="utf-8"
    )
    print("QA evidence:", report["evidenceState"],
          "| validated:", report["validatedDraftPRs"],
          "| status:", report["status"])
    if report["evidenceState"] != "READY_FOR_HUMAN_REVIEW":
        raise SystemExit(1)  # Confronto falhou, NÃO oculta erro do workflow.


if __name__ == "__main__":
    main()
