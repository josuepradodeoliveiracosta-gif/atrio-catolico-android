#!/usr/bin/env python3
"""Conservative offline budget evidence check. This NEVER authorizes production.
No accounts or API keys are accessed. Unknown plans, usage or stale data => NO-GO.
"""
import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

LIMITS = {
    "firestore_reads_day": 50000,
    "firestore_writes_day": 20000,
    "firestore_deletes_day": 20000,
    "firestore_storage_bytes": 1024 ** 3,
    "firestore_egress_month_bytes": 10 * 1024 ** 3,
    "cloudflare_workers_requests_day": 100000,
    "cloudflare_d1_rows_read_day": 5000000,
    "cloudflare_d1_rows_written_day": 100000,
    "cloudflare_d1_storage_bytes": 5 * 1024 ** 3,
}
SAFE_PERCENT = 75  # Conservative project headroom, NOT a provider guarantee.


def template():
    return {
        "captured_at_utc": None,
        "firebase_plan": None,
        "firebase_billing_linked": None,
        "cloudflare_workers_plan": None,
        "cloudflare_paid_subscription_present": None,
        "github_repository_visibility": None,
        "github_runner_type": None,
        "metrics": {name: None for name in LIMITS},
    }


def evaluate(evidence, now=None):
    """Empty list means only budget-within-margin; not a release approval."""
    if not isinstance(evidence, dict):
        return ["invalid_evidence"]
    reasons = []
    expected = template()
    for key in expected:
        if key not in evidence:
            reasons.append("missing:" + key)
    for key in evidence:
        if key not in expected:
            reasons.append("unknown:" + key)
    plans = {
        "firebase_plan": "spark",
        "firebase_billing_linked": False,
        "cloudflare_workers_plan": "free",
        "cloudflare_paid_subscription_present": False,
        "github_repository_visibility": "public",
        "github_runner_type": "standard",
    }
    for key, correct in plans.items():
        if key not in evidence or type(evidence[key]) is not type(correct) or evidence[key] != correct:
            reasons.append("unverified_or_paid:" + key)
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("clock_must_be_aware")
    stamp = evidence.get("captured_at_utc")
    if not isinstance(stamp, str):
        reasons.append("missing_capture_time")
    else:
        try:
            captured = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
            if captured.tzinfo is None or captured.utcoffset() != timedelta(0):
                reasons.append("capture_time_not_utc")
            elif captured < now - timedelta(hours=12) or captured > now + timedelta(minutes=5):
                reasons.append("stale_or_future_capture")
        except ValueError:
            reasons.append("invalid_capture_time")
    metrics = evidence.get("metrics")
    if not isinstance(metrics, dict):
        reasons.append("metrics_missing")
        return reasons
    for key in metrics:
        if key not in LIMITS:
            reasons.append("unknown_metric:" + key)
    for key, ceiling in LIMITS.items():
        value = metrics.get(key)
        if type(value) is not int or value < 0:
            reasons.append("missing_or_invalid_metric:" + key)
        elif value * 100 > SAFE_PERCENT * ceiling:
            reasons.append("free_headroom_exceeded:" + key)
    return reasons


def main():
    parser = argparse.ArgumentParser(description="Offline cost proof; NEVER release approval.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--template", action="store_true")
    mode.add_argument("--check", type=Path)
    args = parser.parse_args()
    if args.template:
        print(json.dumps(template(), ensure_ascii=False, indent=2))
        return 0
    try:
        evidence = json.loads(args.check.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print("GUARDIAN_FREE_BUDGET_NO_GO: invalid_evidence_file", type(exc).__name__)
        return 2
    errors = evaluate(evidence)
    if errors:
        for reason in errors:
            print("GUARDIAN_FREE_BUDGET_NO_GO: " + reason)
        print("Nenhum upgrade ou faturamento autorizado.")
        return 2
    print("GUARDIAN_FREE_BUDGET_WITHIN_MARGIN: apenas conferência local.")
    print("NÃO comprova a conta automaticamente, nem autoriza release, HOLD ou 24/7.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
