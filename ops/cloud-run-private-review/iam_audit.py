#!/usr/bin/env python3
"""Conservative read-only comparison of three Cloud Run/IAM JSON snapshots.

No gcloud, network, credentials, subprocess or IAM/deploy mutations.
A clean direct policy does not establish effective or inherited IAM safety.
"""
import argparse
import json
import re
import sys
from pathlib import Path

PROJECT = "atrio-catolico"
SERVICE = "atrio-privacy-review-internal"
READER = f"atrio-privacy-reader@{PROJECT}.iam.gserviceaccount.com"
MEMBER = f"serviceAccount:{READER}"
VIEWER = {"roles/firebaseauth.viewer", "roles/datastore.viewer"}
CALLER_RE = re.compile(
    r"[a-z][a-z0-9-]{4,28}@[a-z][a-z0-9-]{3,30}\.iam\.gserviceaccount\.com\Z"
)
NAME_RE = re.compile(
    r"projects/atrio-catolico/locations/[a-z0-9-]+/services/atrio-privacy-review-internal\Z"
)
IMAGE_RE = re.compile(
    r"[a-z0-9-]+-docker\.pkg\.dev/atrio-catolico/[a-z0-9-]+/[a-z0-9_./-]+@sha256:[0-9a-f]{64}\Z"
)
UNVERIFIED = [
    "org_folder_inherited_allow_bindings",
    "groups_principal_sets_and_conditions",
    "iam_deny_and_principal_access_boundaries",
    "service_traffic_other_revisions",
    "container_base_and_supply_chain_provenance",
    "iam_effective_access_and_caller_network",
    "real_account_deletion_and_play_approval",
]


def policy_bindings(policy):
    value = policy.get("bindings")
    if not isinstance(value, list):
        raise ValueError("invalid_policy_bindings")
    for binding in value:
        if (
            not isinstance(binding, dict)
            or not isinstance(binding.get("role"), str)
            or not isinstance(binding.get("members"), list)
            or not all(isinstance(m, str) for m in binding["members"])
        ):
            raise ValueError("invalid_policy_binding")
        yield binding


def audit(service, service_policy, project_policy, caller):
    """Return only standardized issue codes; never print private policy data."""
    if not all(isinstance(x, dict) for x in (service, service_policy, project_policy)):
        return ["invalid_snapshot"]
    failures = set()
    if not isinstance(caller, str) or not CALLER_RE.fullmatch(caller) or caller == READER:
        failures.add("invalid_caller")
    if not NAME_RE.fullmatch(str(service.get("name", ""))):
        failures.add("unexpected_project_or_service")
    if service.get("ingress") != "INGRESS_TRAFFIC_INTERNAL_ONLY":
        failures.add("unverified_internal_ingress")
    if service.get("invokerIamDisabled") is not False:
        failures.add("invoker_auth_not_explicitly_enabled")
    template = service.get("template")
    if not isinstance(template, dict):
        template = {}
        failures.add("invalid_service_template")
    if template.get("serviceAccount") != READER:
        failures.add("unexpected_runtime_service_account")
    if template.get("maxInstanceRequestConcurrency") != 1:
        failures.add("unexpected_concurrency")
    scaling = template.get("scaling")
    if not isinstance(scaling, dict):
        scaling = {}
    if (
        scaling.get("maxInstanceCount") not in (1, "1")
        or scaling.get("minInstanceCount", 0) not in (0, "0")
    ):
        failures.add("unverified_scaling_bounds")
    containers = template.get("containers")
    if (
        not isinstance(containers, list)
        or len(containers) != 1
        or not isinstance(containers[0], dict)
        or not isinstance(containers[0].get("image"), str)
        or not IMAGE_RE.fullmatch(containers[0]["image"])
    ):
        failures.add("missing_immutable_artifact_registry_digest")
    try:
        service_bindings = list(policy_bindings(service_policy))
        project_bindings = list(policy_bindings(project_policy))
    except ValueError:
        return sorted(failures | {"malformed_iam_policy"})
    expected_caller = f"serviceAccount:{caller}"
    invocation = [x for x in service_bindings if x["role"] == "roles/run.invoker"]
    if (
        len(invocation) != 1
        or invocation[0]["members"] != [expected_caller]
        or "condition" in invocation[0]
    ):
        failures.add("invoker_binding_not_exclusive")
    if any(
        x["role"] != "roles/run.invoker" or "condition" in x
        for x in service_bindings
    ):
        failures.add("unreviewed_service_policy_role_or_condition")
    if any(x["role"] == "roles/run.invoker" for x in project_bindings):
        failures.add("project_wide_invoker_grant")
    reader = [x for x in project_bindings if MEMBER in x["members"]]
    if {x["role"] for x in reader} != VIEWER:
        failures.add("missing_or_excessive_reader_roles")
    if any("condition" in x for x in reader):
        failures.add("conditional_reader_grant")
    return sorted(failures)


def summary(issues):
    return {
        "status": "direct_snapshots_consistent" if not issues else "blocked_iam_preflight",
        "issues": issues,
        "effectivePermissionsVerified": False,
        "organizationAndFolderPoliciesVerified": False,
        "realCloudRunCallerVerified": False,
        "accountDeletionAuthorized": False,
        "googlePlayReleaseAuthorized": False,
        "unverifiedScopes": UNVERIFIED,
    }


def read_json(path):
    file = Path(path)
    if not file.is_file() or file.stat().st_size > 2_000_000:
        raise ValueError("missing_or_excessive_snapshot")
    data = json.loads(file.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("not_an_object")
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Offline Cloud Run and IAM snapshot review (no mutations)"
    )
    parser.add_argument("--service-json", required=True)
    parser.add_argument("--service-iam-json", required=True)
    parser.add_argument("--project-iam-json", required=True)
    parser.add_argument("--caller", required=True)
    args = parser.parse_args(argv)
    try:
        snapshots = [
            read_json(p)
            for p in (args.service_json, args.service_iam_json, args.project_iam_json)
        ]
        issues = audit(*snapshots, args.caller)
    except (OSError, ValueError, UnicodeError):
        issues = ["untrusted_or_missing_snapshot"]
    print(json.dumps(summary(issues), sort_keys=True))
    return 0 if not issues else 2


if __name__ == "__main__":
    sys.exit(main())
