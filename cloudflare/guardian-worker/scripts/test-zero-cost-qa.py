#!/usr/bin/env python3
"""Mutation tests: QA gate must reject security and billing config drift."""
import copy
import tomllib
import importlib.util
module_path = __import__("pathlib").Path(__file__).with_name("check-zero-cost-qa.py")
spec = importlib.util.spec_from_file_location("zero_cost_guard", module_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
CONFIG, verify = mod.CONFIG, mod.verify


def must_fail(source, label):
    try:
        verify(source)
    except ValueError:
        return
    raise AssertionError("zero_cost_qa_gate_accepted_unsafe_" + label)


with CONFIG.open("rb") as f:
    safe = tomllib.load(f)
verify(safe)
for name, key, value in [
    ("moderation", "GUARDIAN_V2_ENABLED", "true"),
    ("hold", "GUARDIAN_V2_HOLD_ENABLED", "true"),
    ("firebase_bridge", "GUARDIAN_V2_QA_FIRESTORE_BRIDGE", "true"),
    ("shadow", "GUARDIAN_V2_QA_SHADOW_READS", "true"),
    ("dispatch", "GUARDIAN_V2_QA_AUTO_DISPATCH", "true"),
    ("credential", "GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON", "FAKE"),
    ("production", "GUARDIAN_V2_QA_READER_PROJECT", "atrio-catolico"),
]:
    bad = copy.deepcopy(safe)
    bad["vars"][key] = value
    must_fail(bad, name)
for name, mutate in [
    ("billing", lambda c: c.update({"billing": {"mode": "paid"}})),
    ("cron", lambda c: c["triggers"].update({"crons": ["* * * * *"]})),
    ("d1", lambda c: c["d1_databases"][0].update({"database_id": "production"})),
    ("ratelimit", lambda c: c["ratelimits"][0]["simple"].update({"limit": 2000})),
    ("worker", lambda c: c.update({"name": "atrio-push"})),
]:
    bad = copy.deepcopy(safe)
    mutate(bad)
    must_fail(bad, name)
print("GUARDIAN_ZERO_COST_QA_MUTATION_PASS: 12 unsafe configs rejected")
