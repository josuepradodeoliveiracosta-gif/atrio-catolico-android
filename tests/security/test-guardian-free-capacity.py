#!/usr/bin/env python3
"""Offline mutation tests, synthetic data only; no credentials or API calls."""
import copy
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

source = Path(__file__).resolve().parents[2] / "scripts" / "guardian-free-capacity.py"
spec = importlib.util.spec_from_file_location("guardian_free_capacity", source)
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
now = datetime(2026, 10, 30, 18, 0, tzinfo=timezone.utc)
valid = check.template()
valid.update({
    "captured_at_utc": now.isoformat().replace("+00:00", "Z"),
    "firebase_plan": "spark",
    "firebase_billing_linked": False,
    "cloudflare_workers_plan": "free",
    "cloudflare_paid_subscription_present": False,
    "github_repository_visibility": "public",
    "github_runner_type": "standard",
})
for key, ceiling in check.LIMITS.items():
    valid["metrics"][key] = ceiling // 2
assert check.evaluate(valid, now=now) == []
mutations = {
    "unknown_spark": lambda x: x.update(firebase_plan=None),
    "blaze": lambda x: x.update(firebase_plan="blaze"),
    "firebase_billing": lambda x: x.update(firebase_billing_linked=True),
    "unknown_cloudflare": lambda x: x.update(cloudflare_workers_plan=None),
    "cloudflare_paid": lambda x: x.update(cloudflare_workers_plan="paid"),
    "cf_subscription": lambda x: x.update(cloudflare_paid_subscription_present=True),
    "private_repo": lambda x: x.update(github_repository_visibility="private"),
    "larger_runner": lambda x: x.update(github_runner_type="larger"),
    "missing_metrics": lambda x: x.pop("metrics"),
    "missing_reads": lambda x: x["metrics"].pop("firestore_reads_day"),
    "high_reads": lambda x: x["metrics"].update(firestore_reads_day=40001),
    "high_d1": lambda x: x["metrics"].update(cloudflare_d1_rows_read_day=4000000),
    "high_worker": lambda x: x["metrics"].update(cloudflare_workers_requests_day=75001),
    "negative": lambda x: x["metrics"].update(firestore_writes_day=-1),
    "bool_is_not_number": lambda x: x["metrics"].update(firestore_writes_day=True),
    "unknown_metric": lambda x: x["metrics"].update(other=0),
    "missing_time": lambda x: x.update(captured_at_utc=None),
    "stale_time": lambda x: x.update(captured_at_utc=(now-timedelta(days=1)).isoformat()),
    "future_time": lambda x: x.update(captured_at_utc=(now+timedelta(hours=1)).isoformat()),
    "extra_field": lambda x: x.update(production_authorized=True),
}
for label, mutation in mutations.items():
    obj = copy.deepcopy(valid)
    mutation(obj)
    assert check.evaluate(obj, now=now), "unsafe mutation passed: " + label
for key, ceiling in check.LIMITS.items():
    obj = copy.deepcopy(valid)
    obj["metrics"][key] = ceiling
    assert check.evaluate(obj, now=now), "exceeded 75%: " + key
assert check.evaluate(None, now=now)
assert check.evaluate(check.template(), now=now)
assert check.evaluate(valid, now=now+timedelta(hours=13))
print("GUARDIAN_FREE_CAPACITY_MUTATION_PASS: 20 unsafe cases + 9 limits + missing/stale")
