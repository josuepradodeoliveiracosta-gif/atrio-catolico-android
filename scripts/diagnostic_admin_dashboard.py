#!/usr/bin/env python3
"""Private, offline administrative view of sanitized diagnostic snapshots."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from html import escape
import os
from pathlib import Path
import re
import stat

from scripts.operational_diagnostic_center import (
    COMPONENTS, ENVIRONMENTS, MAX_AGE, read_json, utc, qa_metadata)
from scripts.ci_quality_report import REPO

MAX_HISTORY = 30
CI_STATES = ("failure_observed", "incomplete", "checks_passed")
ROW_STATES = ("unknown", "stale", "reported_ok", "reported_degraded", "reported_failed")
LABELS = {"unknown": "Sem evidência", "stale": "Vencido", "reported_ok": "Normal relatado",
          "reported_degraded": "Degradação relatada", "reported_failed": "Falha relatada",
          "failure_observed": "Falha de CI observada", "incomplete": "CI incompleto",
          "checks_passed": "Checks aprovados no snapshot"}


def validate(snapshot, now):
    if (not isinstance(snapshot, dict) or set(snapshot) != {
            "schema_version", "repository", "commit_sha", "generated_at", "mode", "ci",
            "operational", "qa_metadata", "operational_health_verified", "root_cause_confirmed",
            "automatic_actions_executed", "network_requests_performed"}
            or type(snapshot["schema_version"]) is not int or snapshot["schema_version"] != 1
            or snapshot["repository"] != REPO or snapshot["mode"] != "offline_read_only"
            or not isinstance(snapshot["commit_sha"], str)
            or not re.fullmatch(r"[0-9a-f]{40}", snapshot["commit_sha"])
            or snapshot["operational_health_verified"] is not False
            or snapshot["root_cause_confirmed"] is not False
            or type(snapshot["automatic_actions_executed"]) is not int
            or snapshot["automatic_actions_executed"] != 0
            or type(snapshot["network_requests_performed"]) is not int
            or snapshot["network_requests_performed"] != 0):
        raise ValueError("snapshot fora do contrato")
    generated = utc(snapshot["generated_at"])
    if generated > now:
        raise ValueError("snapshot futuro")
    ci = snapshot["ci"]
    counts = ("failed_checks", "non_success_checks", "expected_required_checks", "blocking_expected_checks")
    if (not isinstance(ci, dict) or set(ci) != set(counts) | {"state", "source_event", "head_freshness"}
            or ci["state"] not in CI_STATES or ci["source_event"] not in ("push", "pull_request", "unknown")
            or ci["head_freshness"] != "unknown_without_current_head"
            or any(type(ci[k]) is not int or not 0 <= ci[k] <= 600 for k in counts)
            or ci["failed_checks"] > ci["non_success_checks"]
            or ci["blocking_expected_checks"] > ci["expected_required_checks"]
            or (ci["state"] == "failure_observed") != (ci["failed_checks"] > 0)
            or (ci["state"] == "checks_passed" and (ci["non_success_checks"] or
                ci["blocking_expected_checks"] or ci["source_event"] == "unknown"))):
        raise ValueError("CI invalido")
    expected = {(env, component) for env in ENVIRONMENTS for component in COMPONENTS}
    rows = snapshot["operational"]
    if not isinstance(rows, list) or len(rows) != len(expected):
        raise ValueError("inventario invalido")
    seen, cleaned = set(), []
    for row in rows:
        if (not isinstance(row, dict) or set(row) != {"environment", "component", "state",
                "severity", "observed_at", "source"} or row["environment"] not in ENVIRONMENTS
                or row["component"] not in COMPONENTS or row["state"] not in ROW_STATES):
            raise ValueError("linha operacional invalida")
        key = row["environment"], row["component"]
        if key in seen:
            raise ValueError("linha duplicada")
        seen.add(key)
        state = row["state"]
        severity = {"unknown": "unknown", "stale": "unknown", "reported_ok": "none",
                    "reported_degraded": "warning", "reported_failed": "high"}[state]
        if row["severity"] != severity:
            raise ValueError("gravidade divergente")
        if state == "unknown":
            if row["observed_at"] is not None or row["source"] != "not_collected":
                raise ValueError("estado desconhecido invalido")
        else:
            if row["source"] != "manual_unverified":
                raise ValueError("fonte invalida")
            observed = utc(row["observed_at"])
            if observed > generated:
                raise ValueError("observacao futura")
            if now - observed > MAX_AGE:
                state = "stale"
        cleaned.append({"environment": key[0], "component": key[1], "state": state,
                        "historical_state": row["state"], "observed_at": row["observed_at"]})
    if seen != expected:
        raise ValueError("inventario incompleto")
    raw_metadata = snapshot["qa_metadata"]
    if not isinstance(raw_metadata, list) or len(raw_metadata) > 5:
        raise ValueError("metadados invalidos")
    receipts = []
    for row in raw_metadata:
        if (not isinstance(row, dict) or row.get("source") != "imported_unverified"
                or type(row.get("stale")) is not bool):
            raise ValueError("fonte de metadados invalida")
        receipts.append({k: v for k, v in row.items() if k not in ("source", "stale")})
    # Validate against generation time, then recompute current age.
    qa_metadata(receipts, generated)
    metadata = qa_metadata(receipts, now)
    for item, original in zip(metadata, raw_metadata):
        item["stale"] = item["stale"] or original["stale"]
    return {"sha": snapshot["commit_sha"], "generated": snapshot["generated_at"],
            "stale": now-generated > MAX_AGE, "ci": dict(ci), "rows": cleaned, "metadata": metadata}


def model(snapshots, *, now):
    if not isinstance(now, datetime) or now.tzinfo is None:
        raise ValueError("relogio invalido")
    now = now.astimezone(timezone.utc)
    if not isinstance(snapshots, list) or not 1 <= len(snapshots) <= MAX_HISTORY:
        raise ValueError("historico deve conter 1 a 30 snapshots")
    items = [validate(s, now) for s in snapshots]
    identities = {(s["sha"], s["generated"]) for s in items}
    if len(identities) != len(items):
        raise ValueError("snapshot duplicado")
    items.sort(key=lambda s: (s["generated"], s["sha"]), reverse=True)
    latest = items[0]
    # Same-second reports on distinct commits cannot establish a unique latest.
    ambiguous = len(items) > 1 and items[1]["generated"] == latest["generated"]
    counts = Counter(r["state"] for r in latest["rows"])
    history = []
    for item in items:
        if item["ci"]["state"] != "checks_passed":
            history.append((item["generated"], item["sha"][:12], "CI", "checks",
                            item["ci"]["state"], "sinal de CI; causa não confirmada"))
        for r in item["rows"]:
            if r["historical_state"] in ("reported_degraded", "reported_failed"):
                history.append((item["generated"], item["sha"][:12], r["environment"], r["component"],
                                r["historical_state"], "observação manual não verificada"))
    return {"latest": latest, "counts": counts, "history": history,
            "snapshot_count": len(items), "ambiguous_latest": ambiguous}


def table(headers, rows):
    def cells(tag, values):
        return "".join(f"<{tag}>" + escape(str(x)) + f"</{tag}>" for x in values)
    return ('<table><thead><tr>' + "".join('<th scope="col">'+escape(h)+'</th>' for h in headers)
            + '</tr></thead><tbody>' + "".join('<tr>'+cells('td', row)+'</tr>' for row in rows)
            + '</tbody></table>')


def render(data):
    latest, counts = data["latest"], data["counts"]
    note = ("Ordem atual ambígua: snapshots do mesmo segundo." if data["ambiguous_latest"]
            else "Snapshot mais recente dentre os arquivos fornecidos.")
    age = "Snapshot vencido." if latest["stale"] else "Snapshot dentro da janela de 24 h."
    parts = ['<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">',
             '<meta name="viewport" content="width=device-width, initial-scale=1">',
             '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">',
             '<meta name="referrer" content="no-referrer">',
             '<title>Central de diagnóstico — Átrio Católico</title>',
             '<style>body{font:1rem/1.55 system-ui,sans-serif;background:#fafafa;color:#222;max-width:76rem;margin:auto;padding:1rem}h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%;overflow-wrap:anywhere}th,td{text-align:left;border:1px solid #aaa;padding:.5rem;vertical-align:top}th{background:#e7e7e7}section{margin:2rem 0} .scroll{overflow:auto} @media(prefers-color-scheme:dark){body{background:#171717;color:#eee}th{background:#333}th,td{border-color:#888}}</style></head><body><main>',
             '<h1>Central de diagnóstico — Átrio Católico</h1>',
             '<p>Visão administrativa local, somente leitura. Arquivos importados não são atestações autenticadas. Nenhuma saúde global, causa raiz, reparo ou autorização de integração comprovados.</p>',
             '<p>'+escape(note+' '+age)+'</p>',
             '<p>SHA: <code>'+escape(latest["sha"])+'</code> — '+escape(latest["generated"])+' (UTC). HEAD atual não consultado.</p>',
             '<section><h2>Indicadores do snapshot</h2>',
             '<p>'+escape(LABELS[latest["ci"]["state"]])+'; checks com falha: '+str(latest["ci"]["failed_checks"])+'</p>',
             '<div class="scroll">'+table(("Estado operacional (não verificado)", "Total"), [(LABELS[s], counts[s]) for s in ROW_STATES])+'</div></section>',
             '<section><h2>Ambientes e componentes</h2><div class="scroll">',
             table(("Ambiente", "Componente", "Estado", "Gravidade de triagem", "Observado (UTC)"),
                   [(r["environment"], r["component"], LABELS[r["state"]],
                     {"reported_failed":"Alta", "reported_degraded":"Atenção", "reported_ok":"Nenhuma"}.get(r["state"],"Indeterminada"),
                     r["observed_at"] or "—") for r in latest["rows"]]), '</div></section>',
             '<section><h2>Metadados QA importados</h2><p>Não constituem teste de saúde.</p><div class="scroll">',
             table(("Ambiente", "Sonda", "Resultado", "Validade"),
                   [(r["environment"],r["probe"],r["outcome"],"Vencido" if r["stale"] else "Dentro da janela") for r in latest["metadata"]]),
             '</div></section><section><h2>Histórico de sinais para revisão</h2>',
             '<p>'+str(data["snapshot_count"])+' snapshots fornecidos. Repetições não representam incidentes distintos; ausência posterior não comprova resolução.</p>',
             '<div class="scroll">'+table(("Snapshot UTC", "SHA", "Ambiente", "Componente", "Sinal", "Natureza"),
                    [(t,s,e,c,LABELS[state],nature) for t,s,e,c,state,nature in data["history"]])+'</div></section>',
             '</main></body></html>']
    return "\n".join(parts)


def write_private(directory, content):
    # A trusted local operator creates the directory; no HTTP server or publish.
    if os.name != "posix":
        raise ValueError("diretorio privado POSIX obrigatorio")
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError("diretorio precisa pertencer ao operador e ter modo 0700")
        out = os.open("diagnostics.html", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                      0o600, dir_fd=fd)
        with os.fdopen(out, "w", encoding="utf-8") as handle:
            handle.write(content)
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", action="append", required=True)
    parser.add_argument("--private-dir", required=True)
    args = parser.parse_args()
    if not 1 <= len(args.snapshot) <= MAX_HISTORY:
        parser.error("limite de 30 snapshots")
    data = model([read_json(p) for p in args.snapshot], now=datetime.now(timezone.utc))
    write_private(Path(args.private_dir), render(data))
    print("Painel local criado; nenhuma publicação ou rede.")


if __name__ == "__main__":
    main()
