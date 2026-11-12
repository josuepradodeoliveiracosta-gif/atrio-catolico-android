#!/usr/bin/env python3
"""Read-only, evidence-linked diagnostic digest of a single SHA's CI report.

Consumes the existing ci_quality_report.py JSON. It never queries remote APIs,
uses no credentials, does not decide whether merging is safe, and never guesses
root causes or whether a PR's HEAD changed.
"""
import argparse
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from scripts.ci_quality_report import REPO, REQUIRED, safe_markdown, validate_sha

MAX_CHECKS = 600
MAX_ROWS = 20
DETAIL_PATH = re.compile(
    rf"/{re.escape(REPO)}/(?:actions/runs/[0-9]+(?:/job/[0-9]+)?|runs/[0-9]+)"
)
STATUSES = {"failure", "timed_out", "action_required", "cancelled", "skipped", "neutral", "stale"}



# Fixed, non-executing review hints; never infer a root cause from check status.
SAFE_REVIEW = {
    "Detectar segredos em arquivos e histórico Git": (
        "review_secret_scan_privately",
        "Examinar a verificacao de segredos em ambiente restrito; nao incluir tokens nos relatorios."),
    "Evitar regressão de versionCode e versionName": (
        "review_version_contract",
        "Conferir o contrato de versao sem publicar APK automaticamente."),
    "Regras de seguranca Firestore": (
        "review_firestore_emulator",
        "Reproduzir regras em emulador QA isolado; nao modificar Firestore de producao."),
    "Compilar Android de testes": (
        "review_android_debug",
        "Inspecionar compilacao Debug; nao assinar nem publicar release."),
    "Bloquear exclusoes em massa (Atrio)": (
        "review_mass_delete_guard",
        "Investigar bloqueio de exclusoes sem relaxar as protecoes existentes."),
}


def safe_next_step(check_name, state):
    """Deterministic triage: safe guidance, not a fix or causal diagnosis."""
    if state == "pending":
        return {"id": "await_check_completion",
                "guidance": "Aguardar resultado definitivo antes de classificar a verificacao."}
    if state == "missing":
        return {"id": "verify_check_event_scope",
                "guidance": "Verificar aplicabilidade do check ao evento e SHA; ausencia nao e falha comprovada."}
    if state in ("skipped", "neutral", "cancelled", "stale", "unknown"):
        return {"id": "review_non_success_context",
                "guidance": "Verificar contexto da conclusao sem equiparar o estado a aprovacao."}
    key, guide = SAFE_REVIEW.get(check_name, (
        "review_job_evidence",
        "Consultar evidencia do job referente ao SHA exato; causa raiz nao inferida."))
    return {"id": key, "guidance": guide}

def safe_evidence_url(raw):
    """Return only an exact link to a GitHub Actions run/job in this repository."""
    if not isinstance(raw, str) or len(raw) > 2048:
        return None
    try:
        url = urlsplit(raw)
        valid_port = url.port in (None, 443)
    except ValueError:
        return None
    if (url.scheme != "https" or url.hostname != "github.com"
            or url.username or url.password or not valid_port
            or not DETAIL_PATH.fullmatch(url.path)):
        return None
    return f"https://github.com{url.path}"


def safe_label(raw):
    """Escape check names as *text*, never executable Markdown links/images."""
    value = re.sub(r"[\x00-\x1f\x7f]", " ", str(raw))
    for character in ("\\", "[", "]", "(", ")", "!", chr(96)):
        value = value.replace(character, "\\" + character)
    return safe_markdown(value)


def check_state(check):
    status = check.get("status")
    conclusion = check.get("conclusion")
    if status != "completed":
        return "pending"
    if conclusion == "success":
        return "success"
    if conclusion in STATUSES:
        return conclusion
    return "unknown"


def digest(report, current_head_sha=None):
    if not isinstance(report, dict):
        raise ValueError("relatorio precisa ser um objeto")
    sha = validate_sha(report.get("commit_sha"))
    if current_head_sha is not None:
        validate_sha(current_head_sha)
    checks = report.get("checks")
    required = report.get("required_checks")
    if not isinstance(checks, list) or not isinstance(required, dict) or len(checks) > MAX_CHECKS:
        raise ValueError("relatorio ausente ou checks acima do limite")
    if not all(isinstance(x, dict) and isinstance(x.get("name"), str)
               for x in checks):
        raise ValueError("check invalido")
    if any(x not in required or required[x] not in
           ("missing", "pending", "not-success", "success") for x in REQUIRED):
        raise ValueError("estado obrigatório ausente ou desconhecido")
    if report.get("repository") != REPO:
        raise ValueError("relatorio de outro repositorio")
    if not isinstance(report.get("all_required_success"), bool):
        raise ValueError("estado geral invalido")
    if report["all_required_success"] != all(required[x] == "success" for x in REQUIRED):
        raise ValueError("inconsistencia entre verificacoes obrigatorias")

    freshness = ("unknown_without_current_head" if current_head_sha is None else
                 "current_head" if sha == current_head_sha else "historical_sha")
    entries = []
    for c in checks:
        state = check_state(c)
        if state == "success":
            continue
        entries.append({
            "name": c["name"][:200],
            "state": state,
            "required": c["name"] in REQUIRED,
            "evidence_url": safe_evidence_url(c.get("details_url")),
            "safe_next_step": safe_next_step(c["name"], state),
        })
    severity = {"failure": 0, "timed_out": 0, "action_required": 0,
                "cancelled": 1, "skipped": 1, "neutral": 1, "stale": 1,
                "pending": 2, "unknown": 3}
    entries.sort(key=lambda e: (0 if e["required"] else 1,
                                severity[e["state"]], e["name"], e["state"]))
    missing = [name for name in REQUIRED if required[name] == "missing"]
    blocked = [name for name in REQUIRED if required[name] != "success"]
    return {
        "repository": REPO,
        "commit_sha": sha,
        "comparison_head_sha": current_head_sha,
        "freshness": freshness,
        "note": "read_only_status_digest_no_root_cause_no_merge_approval",
        "required_blocking": [{"name": name, "state": required[name]} for name in blocked],
        "required_missing": missing,
        "required_review": [{"name": name, "state": required[name],
                             "safe_next_step": safe_next_step(name, required[name])}
                            for name in blocked],
        "non_success_count": len(entries),
        "non_success_checks": entries,
        "all_required_success": report["all_required_success"],
        "cause": "undetermined_not_inferred_from_check_state",
        "auto_triage": {
            "failed_checks": sum(x["state"] in ("failure", "timed_out", "action_required") for x in entries),
            "pending_checks": sum(x["state"] == "pending" for x in entries),
            "automatic_corrections_executed": 0,
            "root_cause_established": False,
            "human_approval_required_for_merges_and_deploy": True,
        },
    }


def markdown_digest(snapshot):
    lines = [
        "## Síntese de diagnóstico por commit (somente leitura)", "",
        f"**SHA:** `{snapshot['commit_sha']}`", "",
        "**Atualidade:** " + {
            "unknown_without_current_head": "não verificada (HEAD da PR não consultado)",
            "current_head": "corresponde ao HEAD informado",
            "historical_sha": "snapshot histórico; não representa o HEAD informado",
        }[snapshot["freshness"]] + ".", "",
        "**Causa raiz:** não determinada; o estado do check, sozinho, não prova a causa.", "",
        "**Aviso:** relatório informativo, não autoriza merge, deploy ou publicação.", "",
        "### Verificações obrigatórias não aprovadas", "",
        "| Verificação | Estado |", "| --- | --- |",
    ]
    for item in snapshot["required_blocking"]:
        lines.append(f"| {safe_label(item['name'])} | {safe_markdown(item['state'])} |")
    if not snapshot["required_blocking"]:
        lines.append("| Nenhuma nesta consulta | — |")
    lines.extend(("", "### Checks não aprovados e evidências", "",
                  "| Check | Estado | Obrigatório | Evidência |", "| --- | --- | --- | --- |"))
    for item in snapshot["non_success_checks"][:MAX_ROWS]:
        ref = (f"[Execução no GitHub]({item['evidence_url']})"
               if item["evidence_url"] else "Link não verificado")
        lines.append(f"| {safe_label(item['name'])} | {item['state']} | "
                     f"{'Sim' if item['required'] else 'Não'} | {ref} |")
    if not snapshot["non_success_checks"]:
        lines.append("| Nenhum nesta consulta | — | — | — |")
    extra = snapshot["non_success_count"] - MAX_ROWS
    if extra > 0:
        lines.extend(("", f"**Mais {extra} checks não exibidos no Markdown; o JSON contém todos.**"))
    if snapshot["required_missing"]:
        lines.extend(("", "**Checks obrigatórios ausentes:** " + ", ".join(
            safe_label(s) for s in snapshot["required_missing"])))
    lines.extend(("", "### Orientacao automatica de triagem (sem correcao)", "",
                  "Apenas recomenda procedimentos seguros; nao baixa logs nem executa comandos.", "",
                  "| Check | Estado | Proxima verificacao |",
                  "| --- | --- | --- |"))
    for item in snapshot["non_success_checks"][:MAX_ROWS]:
        hint = item["safe_next_step"]
        lines.append(f"| {safe_label(item['name'])} | {item['state']} | "
                     f"{safe_label(hint['guidance'])} |")
    for item in snapshot["required_review"]:
        if item["state"] == "missing":
            lines.append(f"| {safe_label(item['name'])} | ausente | "
                         f"{safe_label(item['safe_next_step']['guidance'])} |")
    if not snapshot["non_success_checks"] and not snapshot["required_missing"]:
        lines.append("| Nenhuma neste snapshot | — | — |")
    lines.extend(("", "A triagem e automatica, mas nao autoriza merge, release ou deploy.", ""))
    lines.extend(("", "Execuções canceladas, puladas, pendentes ou históricas não são "
                  "interpretadas como sucesso. Evidências estão restritas a URLs verificadas "
                  "do GitHub no próprio repositório.", ""))
    return "\n".join(lines)


def write_digest(input_json, output_json, input_markdown, current_head_sha=None):
    report = json.loads(Path(input_json).read_text(encoding="utf-8"))
    snapshot = digest(report, current_head_sha=current_head_sha)
    existing = Path(input_markdown).read_text(encoding="utf-8")
    section = "## Síntese de diagnóstico por commit (somente leitura)"
    if section in existing:
        raise ValueError("sintese de diagnostico ja anexada")
    # Build before writing either output, so malformed input cannot partially update the report.
    md = existing.rstrip("\n") + "\n\n" + markdown_digest(snapshot)
    json_text = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
    Path(output_json).write_text(json_text, encoding="utf-8")
    Path(input_markdown).write_text(md, encoding="utf-8")
    return snapshot


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report-json", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--markdown", required=True)
    parser.add_argument("--current-head-sha", default=None)
    args = parser.parse_args()
    snap = write_digest(args.report_json, args.output_json, args.markdown,
                        current_head_sha=args.current_head_sha)
    print("Sintese somente leitura:", snap["commit_sha"],
          "checks nao aprovados:", snap["non_success_count"])


if __name__ == "__main__":
    main()
