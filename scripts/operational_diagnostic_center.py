#!/usr/bin/env python3
"""Central unificada: consolidação offline, sem credenciais ou sondas remotas."""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

from scripts.ci_quality_report import REPO, REQUIRED, PR_ONLY_REQUIRED_ON_PUSH
from scripts.ci_diagnostic_snapshot import digest, check_state

MAX_BYTES = 2_000_000
MAX_AGE = timedelta(hours=24)
ENVIRONMENTS = ("production", "qa_geral", "perfil_qa", "chat_qa", "ota_pilot")
COMPONENTS = ("android_crash", "android_memory", "android_performance",
              "authentication", "connectivity", "firebase_firestore",
              "firebase_messaging", "cloudflare", "guardian", "ota")
STATES = ("ok", "degraded", "failed")
SEVERITY = {"ok": "none", "degraded": "warning", "failed": "high"}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("chave JSON duplicada")
        result[key] = value
    return result


def read_json(path):
    with Path(path).open("rb") as handle:
        raw = handle.read(MAX_BYTES + 1)
    if not 0 < len(raw) <= MAX_BYTES:
        raise ValueError("entrada vazia ou acima do limite")
    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)


def utc(value):
    if not isinstance(value, str) or len(value) != 20:
        raise ValueError("timestamp UTC invalido")
    parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != value:
        raise ValueError("timestamp UTC nao canonico")
    return parsed


def observation_index(manifest, now):
    """Aceita somente enums e timestamp; nunca texto de erro, UID ou token."""
    if manifest is None:
        return {}
    if (not isinstance(manifest, dict) or set(manifest) != {"schema_version", "observations"}
            or type(manifest["schema_version"]) is not int or manifest["schema_version"] != 1
            or not isinstance(manifest["observations"], list)
            or len(manifest["observations"]) > len(ENVIRONMENTS) * len(COMPONENTS)):
        raise ValueError("manifesto operacional invalido")
    index = {}
    for row in manifest["observations"]:
        if (not isinstance(row, dict)
                or set(row) != {"environment", "component", "state", "observed_at"}
                or row["environment"] not in ENVIRONMENTS
                or row["component"] not in COMPONENTS or row["state"] not in STATES):
            raise ValueError("observacao fora do contrato")
        observed = utc(row["observed_at"])
        if observed > now:
            raise ValueError("observacao futura")
        key = (row["environment"], row["component"])
        if key in index:
            raise ValueError("observacao duplicada")
        index[key] = row
    return index


def build(report, manifest=None, *, now):
    if not isinstance(now, datetime) or now.tzinfo is None:
        raise ValueError("relogio de referencia deve ter fuso")
    now = now.astimezone(timezone.utc)
    snapshot = digest(report)
    event = report.get("source_event", "unknown")
    if event not in ("push", "pull_request", "unknown"):
        raise ValueError("evento de CI invalido")
    required = report["required_checks"]
    expected = [name for name in REQUIRED if not (
        event == "push" and name in PR_ONLY_REQUIRED_ON_PUSH and required[name] == "missing")]
    failed = sum(check_state(c) in ("failure", "timed_out", "action_required")
                 for c in report["checks"])
    blocking = sum(required[name] != "success" for name in expected)
    ci_state = ("failure_observed" if failed else
                "incomplete" if blocking or event == "unknown" or snapshot["non_success_count"] else
                "checks_passed")
    indexed = observation_index(manifest, now)
    rows = []
    for env in ENVIRONMENTS:
        for component in COMPONENTS:
            item = indexed.get((env, component))
            stale = item is not None and now - utc(item["observed_at"]) > MAX_AGE
            state = "unknown" if item is None else "stale" if stale else "reported_" + item["state"]
            rows.append({"environment": env, "component": component, "state": state,
                         "severity": "unknown" if item is None or stale else SEVERITY[item["state"]],
                         "observed_at": item["observed_at"] if item else None,
                         "source": "manual_unverified" if item else "not_collected"})
    return {"schema_version": 1, "repository": REPO, "commit_sha": snapshot["commit_sha"],
            "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "mode": "offline_read_only", "ci": {"state": ci_state, "source_event": event,
                "failed_checks": failed, "non_success_checks": snapshot["non_success_count"],
                "expected_required_checks": len(expected), "blocking_expected_checks": blocking,
                "head_freshness": snapshot["freshness"]},
            "operational": rows,
            "operational_health_verified": False, "root_cause_confirmed": False,
            "automatic_actions_executed": 0, "network_requests_performed": 0}


def markdown(result):
    ci = result["ci"]
    lines = ["# Central unificada de diagnóstico (somente leitura)", "",
             f"SHA analisado: `{result['commit_sha']}`",
             f"Gerado em UTC: {result['generated_at']}",
             f"CI: {ci['state']} | evento: {ci['source_event']} | falhas observadas: {ci['failed_checks']}",
             f"Checks obrigatórios aplicáveis não aprovados: {ci['blocking_expected_checks']}",
             "", "HEAD atual não verificado. Checks verdes não comprovam saúde operacional.",
             "Observações manuais não são verificadas; dados ausentes ou vencidos não indicam saúde.",
             "", "| Ambiente | Componente | Estado | Gravidade | Observado (UTC) |",
             "| --- | --- | --- | --- | --- |"]
    for row in result["operational"]:
        lines.append("| " + " | ".join((row["environment"], row["component"], row["state"],
                     row["severity"], row["observed_at"] or "—")) + " |")
    lines.extend(["", "Nenhuma causa raiz, reparo, autorização de merge ou deploy comprovados.", ""])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ci-report", required=True)
    parser.add_argument("--observations", help="manifesto manual opcional, sem dados pessoais")
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    paths = [Path(p).resolve() for p in (args.ci_report, args.observations, args.json, args.markdown) if p]
    if len(set(paths)) != len(paths):
        raise ValueError("origens e destinos devem ser distintos")
    result = build(read_json(args.ci_report),
                   read_json(args.observations) if args.observations else None,
                   now=datetime.now(timezone.utc))
    if Path(args.json).exists() or Path(args.markdown).exists():
        raise ValueError("destinos existentes")
    with Path(args.json).open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    with Path(args.markdown).open("x", encoding="utf-8") as handle:
        handle.write(markdown(result))


if __name__ == "__main__":
    main()
