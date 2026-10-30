#!/usr/bin/env python3
"""QA config guardrail; it cannot attest account billing, plan or 24/7 viability."""
from __future__ import annotations

import pathlib
import tomllib

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG = ROOT / "wrangler.qa.toml"

FLAG_VALUES = {
    "GUARDIAN_V2_TEST_MODE": "true",
    "GUARDIAN_V2_ENABLED": "false",
    "GUARDIAN_V2_HOLD_ENABLED": "false",
    "GUARDIAN_V2_QA_SHADOW_READS": "false",
    "GUARDIAN_V2_QA_FIRESTORE_BRIDGE": "false",
    "GUARDIAN_V2_QA_BRIDGE_NOT_BEFORE": "",
    "GUARDIAN_V2_QA_BRIDGE_EXPIRES_AT": "",
    "GUARDIAN_V2_QA_AUTO_DISPATCH": "false",
    "GUARDIAN_QA_DISPATCH_READY": "false",
    "GUARDIAN_V2_QA_READER_PROJECT": "atrio-catolico-qa-v2",
}

ALLOWED_ROOT = {
    "name", "main", "compatibility_date", "workers_dev", "vars",
    "triggers", "ratelimits", "d1_databases"
}
DB_ID = "5ba3bbe6-e319-4c25-b958-6b53e940fb34"


def verify(cfg: dict) -> None:
    """Require an explicitly isolated, non-privileged QA config (fail closed)."""
    if set(cfg) != ALLOWED_ROOT:
        raise ValueError("qa_config_keys_not_approved")
    if (cfg.get("name") != "atrio-guardian-v2-qa"
            or cfg.get("main") != "src/index.js"
            or cfg.get("workers_dev") is not True):
        raise ValueError("qa_worker_identity_invalid")
    vars_ = cfg.get("vars")
    if not isinstance(vars_, dict):
        raise ValueError("qa_vars_missing")
    for key, value in FLAG_VALUES.items():
        if vars_.get(key) != value:
            raise ValueError("qa_guard_missing_or_enabled:" + key)
    # Reject accidental credentials, broad Firebase access or unexpected vars.
    if set(vars_) != set(FLAG_VALUES) | {
        "GUARDIAN_V2_QA_RUN_MONITOR", "GUARDIAN_V2_QA_POLICY_HEARTBEAT"
    }:
        raise ValueError("qa_vars_not_allowlisted")
    for key in ("GUARDIAN_V2_QA_RUN_MONITOR", "GUARDIAN_V2_QA_POLICY_HEARTBEAT"):
        if vars_.get(key) not in ("true", "false"):
            raise ValueError("qa_monitor_flag_invalid")
    if cfg.get("triggers") != {"crons": ["*/15 * * * *"]}:
        raise ValueError("qa_cron_not_approved")
    rate = cfg.get("ratelimits")
    if not isinstance(rate, list) or len(rate) != 2:
        raise ValueError("qa_rate_limit_bindings_invalid")
    expected = {
        "GUARDIAN_QA_GLOBAL_LIMITER": ("874201", 20, 60),
        "GUARDIAN_QA_TOKEN_LIMITER": ("874202", 3, 60),
    }
    found = {}
    for entry in rate:
        if not isinstance(entry, dict) or set(entry) != {
            "name", "namespace_id", "simple"
        } or not isinstance(entry.get("simple"), dict):
            raise ValueError("qa_limiter_not_approved")
        name = entry["name"]
        if name in found:
            raise ValueError("qa_duplicate_limiter")
        simple = entry["simple"]
        if set(simple) != {"limit", "period"}:
            raise ValueError("qa_limiter_shape")
        found[name] = (str(entry["namespace_id"]),
                       simple["limit"], simple["period"])
    if found != expected:
        raise ValueError("qa_limiter_value_changed")
    db = cfg.get("d1_databases")
    if not isinstance(db, list) or len(db) != 1:
        raise ValueError("qa_only_one_d1")
    if db[0] != {
        "binding": "GUARDIAN_QA_BUDGET_DB",
        "database_name": "atrio-guardian-v2-qa-budget",
        "database_id": DB_ID,
        "migrations_dir": "migrations",
    }:
        raise ValueError("qa_d1_not_isolated")


if __name__ == "__main__":
    with CONFIG.open("rb") as f:
        verify(tomllib.load(f))
    print("GUARDIAN_ZERO_COST_QA_CONFIG_PASS: isolated, no privileged Firebase, no deploy")
