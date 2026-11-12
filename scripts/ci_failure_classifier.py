#!/usr/bin/env python3
"""Offline, fail-closed classifier of *diagnostic signals* in GitHub Actions logs.

This does not infer a proven root cause, approve merges, access GitHub, read
secrets, or modify production. Only stable rule labels and line numbers appear
in output; raw log content is never copied to artifacts.
"""
import argparse
import json
from pathlib import Path
import re

MAX_LOG_BYTES = 2_000_000
MAX_LINES = 40_000
MAX_RULE_SPAN = 15
MAX_GENERIC_SPAN = 250
VALID_CONCLUSIONS = {"failure", "timed_out", "success", "cancelled", "skipped", "unknown"}
SHA_PATTERN = re.compile(r"^[a-f0-9]{40}$")

# Every indicator has a fixed, user-safe description. In particular we never
# insert regex matches, file paths, stacktraces, or log excerpts in output.
RULES = (
    ("ci_contract_mismatch", "Contratos de CI",
     ("test_existing_safe_caches_kept", "setup-gradle@v4", "AssertionError"),
     "O contrato de cache ou versão do workflow rejeitou a alteração."),
    ("kotlin_unresolved_reference", "Compilação Kotlin",
     ("Unresolved reference", "compile", "FAILED"),
     "Referência Kotlin não resolvida durante compilação."),
    ("qa_rules_baseline_assertion", "Fixtures de Rules QA",
     ("base deve conter regras oficiais substanciais", "AssertionError"),
     "Teste offline da cópia versionada de Rules reprovado."),
    ("qa_mock_sha_assertion", "Contrato offline Firebase",
     ("atrio_rules_deploy_local_sha_mismatch", "ERR_ASSERTION"),
     "Teste de mock/contrato SHA divergente; não comprova alteração em produção."),
    ("android_compose_timeout", "Interface Android",
     ("ComposeTimeoutException", "Condition still not satisfied"),
     "Teste de interface não satisfez a condição no prazo."),
    ("android_adb_offline", "Emulador Android",
     ("adb: device offline",),
     "ADB registrou dispositivo offline; isoladamente não comprova a causa do teste."),
    # New, deliberately narrow patterns from an explicitly reviewed
    # development set. Labels are diagnostic signals, not proven root causes.
    ("github_dependency_review_unavailable", "Recursos do GitHub",
     ("Dependency review is not supported on this repository",),
     "A revisao de dependencias declarou-se indisponivel; isto nao comprova vulnerabilidade."),
    ("sqlite_closed_database", "SQLite QA",
     ("sqlite3.ProgrammingError: Cannot operate on a closed database",),
     "O teste usou uma conexao SQLite fechada; revisar ciclo de vida local."),
    ("ci_check_pagination_guard", "Relatorio CI",
     ("RuntimeError: Excesso de checks; recusa relatorio incompleto",),
     "O relatorio recusou uma coleta incompleta por limite de paginacao."),
    ("qa_evidence_readiness_mismatch", "Politica QA",
     ("READY_FOR_HUMAN_REVIEW", "EVIDENCE_INCOMPLETE", "AssertionError"),
     "Teste de prontidao QA encontrou divergencia entre estado previsto e observado."),
    ("qa_firestore_open_grant_contract", "Contrato Rules QA",
     ("no_literal_open_grants': False", "AssertionError"),
     "Teste offline reprovou a verificacao de permissoes abertas nas Rules."),
    ("qa_case_id_contract", "Privacidade QA",
     ("qa_case_invalid_case_id", "ERR_ASSERTION"),
     "Teste de fixture de identidade QA divergiu da expectativa."),
    ("qa_ota_tampered_download_test", "OTA QA",
     ("Teste OTA do app falhou", "rejectsTamperedDownloadedApkBeforeInstall"),
     "Teste isolado de rejeicao de APK alterado falhou; sem concluir falha em producao."),
)
WEAK_RULES = (
    ("generic_compilation_failure", "Compilação",
     ("Compilation error", "BUILD FAILED"),
     "Falha de compilação genérica; conferir etapas do job."),
    ("generic_test_assertion", "Testes",
     ("AssertionError",),
     "Falha de asserção; evidências insuficientes para causa específica."),
)


def validate_sha(sha):
    if not isinstance(sha, str) or not SHA_PATTERN.fullmatch(sha):
        raise ValueError("SHA deve conter exatamente 40 caracteres hexadecimais minúsculos")
    return sha


def positive_int(value):
    try:
        n = int(value)
    except (ValueError, TypeError) as err:
        raise ValueError("identificador invalido") from err
    if n < 1 or n >= 10 ** 18:
        raise ValueError("identificador fora do limite")
    return n


def matching_window(lines, markers, max_span):
    """Find a minimal interval with all markers, in bounded O(N log N).

    Sliding window prevents quadratic work on noisy or adversarial logs and
    avoids false negatives from independently selecting nearest markers.
    """
    if not markers or max_span < 0:
        return None
    hits = []
    for marker_idx, marker in enumerate(markers):
        positions = [(line_idx, marker_idx)
                     for line_idx, line in enumerate(lines, 1) if marker in line]
        if not positions:
            return None
        hits.extend(positions)
    hits.sort()
    counts = [0] * len(markers)
    most_recent = [None] * len(markers)
    covered = 0
    left = 0
    best = None
    for right, (line_no, marker_idx) in enumerate(hits):
        if counts[marker_idx] == 0:
            covered += 1
        counts[marker_idx] += 1
        most_recent[marker_idx] = line_no
        while covered == len(markers):
            window_start = hits[left][0]
            width = line_no - window_start
            if width <= max_span:
                candidate = (width, window_start,
                             tuple(sorted(set(most_recent))))
                if best is None or candidate < best:
                    best = candidate
                    if width == 0:
                        return list(best[2])
            previous_marker_idx = hits[left][1]
            counts[previous_marker_idx] -= 1
            if counts[previous_marker_idx] == 0:
                covered -= 1
            left += 1
    return list(best[2]) if best else None


def classify(log_text, sha, run_id, job_id, job_conclusion="unknown"):
    sha = validate_sha(sha)
    run_id = positive_int(run_id)
    job_id = positive_int(job_id)
    if job_conclusion not in VALID_CONCLUSIONS:
        raise ValueError("conclusao do job invalida")
    if not isinstance(log_text, str):
        raise ValueError("log precisa ser texto")
    if len(log_text.encode("utf-8")) > MAX_LOG_BYTES:
        raise ValueError("log acima do limite")
    lines = log_text.splitlines()
    if len(lines) > MAX_LINES:
        raise ValueError("linhas acima do limite")
    # Require verified failure/timed_out state; a passing job can contain
    # failures as *test fixture examples* and must never look like a real incident.
    eligible = job_conclusion in ("failure", "timed_out")
    flags = []
    if eligible:
        for label, category, markers, description in RULES:
            found_lines = matching_window(lines, markers, MAX_RULE_SPAN)
            if found_lines:
                flags.append({
                    "rule_id": label, "category": category,
                    "signal": description,
                    "evidence_line_numbers": found_lines,
                    "evidence_strength": "multiple_markers" if len(markers) > 1 else "single_marker",
                })
        if not flags:
            for label, category, markers, description in WEAK_RULES:
                found_lines = matching_window(lines, markers, MAX_GENERIC_SPAN)
                if found_lines:
                    flags.append({
                        "rule_id": label, "category": category,
                        "signal": description,
                        "evidence_line_numbers": found_lines,
                        "evidence_strength": "generic",
                    })
    flags.sort(key=lambda f: f["rule_id"])
    return {
        "repository": "josuepradodeoliveiracosta-gif/atrio-catolico-android",
        "commit_sha": sha,
        "run_id": run_id,
        "job_id": job_id,
        "mode": "offline_only",
        "job_conclusion": job_conclusion,
        "classification": ("not_applicable_nonfailed_job" if not eligible else
                           "inconclusive" if not flags else
                           "multiple_signals_review_needed" if len(flags) > 1 else
                           "single_signal_review_needed"),
        "root_cause": "not_established",
        "confidence": "not_calculated",
        "signals": flags,
        "total_lines": len(lines),
        "input_bytes": len(log_text.encode("utf-8")),
        "automated_actions": "none",
    }


def markdown_report(out):
    rows = [
        "## Triagem offline de sinais de falha", "",
        f"**SHA:** `{out['commit_sha']}`",
        f"**Run/job:** {out['run_id']} / {out['job_id']}", "",
        "**Causa raiz não comprovada.** Este documento não recomenda merge "
        + "nem aciona reexecução ou deploy.", "",
        f"**Estado:** {out['classification']}", "",
        "| Categoria | Regra | Linhas de evidência | Sinal |",
        "| --- | --- | --- | --- |",
    ]
    for item in out["signals"]:
        row_lines = ", ".join(map(str, item["evidence_line_numbers"]))
        rows.append(f"| {item['category']} | `{item['rule_id']}` | "
                    f"{row_lines} | {item['signal']} |")
    if not out["signals"]:
        rows.append("| Inconclusivo | — | — | Nenhum padrão confiável identificado |")
    rows.extend(("", "Nenhum trecho de log foi incluído no relatório. "
                 + "Conferir o log original sob controle de acesso adequado.", ""))
    return "\n".join(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--log-file", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--job-conclusion", required=True,
                        choices=sorted(VALID_CONCLUSIONS),
                        help="Estado conferido via GitHub Actions; unknown impede classificacao")
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    log_path = Path(args.log_file)
    if log_path.stat().st_size > MAX_LOG_BYTES:
        parser.error("log acima do limite")
    data = log_path.read_text(encoding="utf-8", errors="replace")
    out = classify(data, args.sha, args.run_id, args.job_id,
                   job_conclusion=args.job_conclusion)
    # Validate everything before writing either output.
    js = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    md = markdown_report(out)
    Path(args.json).write_text(js, encoding="utf-8")
    Path(args.markdown).write_text(md, encoding="utf-8")
    print("Triagem offline:", out["classification"], "sinais:", len(out["signals"]))


if __name__ == "__main__":
    main()
