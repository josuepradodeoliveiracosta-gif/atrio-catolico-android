import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from iam_audit import audit, summary, PROJECT, SERVICE, READER

CALLER = "atrio-caller-private@atrio-catolico.iam.gserviceaccount.com"
MEMBER = f"serviceAccount:{READER}"
IMAGE = ("southamerica-east1-docker.pkg.dev/atrio-catolico/"
         "private/review@sha256:" + "a" * 64)


def fixture():
    svc = dict(
        name=f"projects/{PROJECT}/locations/southamerica-east1/services/{SERVICE}",
        ingress="INGRESS_TRAFFIC_INTERNAL_ONLY", invokerIamDisabled=False,
        template={
            "serviceAccount": READER, "maxInstanceRequestConcurrency": 1,
            "scaling": {"maxInstanceCount": 1, "minInstanceCount": 0},
            "containers": [{"image": IMAGE}],
        }
    )
    si = {"bindings": [{
        "role": "roles/run.invoker", "members": [f"serviceAccount:{CALLER}"]
    }]}
    pi = {"bindings": [
        {"role": role, "members": [MEMBER]}
        for role in ("roles/datastore.viewer", "roles/firebaseauth.viewer")
    ]}
    return svc, si, pi


class OfflineAuditTests(unittest.TestCase):
    def issue(self, issue, mutation):
        data = fixture()
        mutation(*data)
        self.assertIn(issue, audit(*data, CALLER))

    def test_direct_consistency_is_not_real_authorization(self):
        self.assertEqual(audit(*fixture(), CALLER), [])
        result = summary([])
        for flag in ("effectivePermissionsVerified", "googlePlayReleaseAuthorized",
                     "accountDeletionAuthorized"):
            self.assertFalse(result[flag])

    def test_public_access_and_invoker_bypass(self):
        self.issue("unverified_internal_ingress",
                   lambda s, a, b: s.update(ingress="INGRESS_TRAFFIC_ALL"))
        self.issue("invoker_auth_not_explicitly_enabled",
                   lambda s, a, b: s.update(invokerIamDisabled=True))
        self.issue("invoker_auth_not_explicitly_enabled",
                   lambda s, a, b: s.pop("invokerIamDisabled"))
        self.issue("invoker_binding_not_exclusive",
                   lambda s, a, b: a["bindings"][0]["members"].append("allUsers"))
        self.issue("project_wide_invoker_grant",
                   lambda s, a, b: b["bindings"].append({
                       "role": "roles/run.invoker", "members": ["allUsers"]
                   }))

    def test_privileged_or_different_reader(self):
        self.issue("unexpected_runtime_service_account",
                   lambda s, a, b: s["template"].update(serviceAccount="default"))
        self.issue("missing_or_excessive_reader_roles",
                   lambda s, a, b: b["bindings"].append({
                       "role": "roles/editor", "members": [MEMBER]
                   }))
        self.issue("missing_or_excessive_reader_roles",
                   lambda s, a, b: b["bindings"].pop())
        self.issue("conditional_reader_grant",
                   lambda s, a, b: b["bindings"][0].update(
                       condition={"expression": "true"}))
        self.assertIn("invalid_caller", audit(*fixture(), READER))
        self.assertIn("invalid_caller", audit(*fixture(), "allUsers"))

    def test_unbounded_build_or_malformed_policy(self):
        self.issue("unverified_scaling_bounds",
                   lambda s, a, b: s["template"]["scaling"].update(maxInstanceCount=10))
        self.issue("unexpected_concurrency",
                   lambda s, a, b: s["template"].update(maxInstanceRequestConcurrency=100))
        self.issue("missing_immutable_artifact_registry_digest",
                   lambda s, a, b: s["template"]["containers"][0].update(image="node:latest"))
        self.issue("malformed_iam_policy",
                   lambda s, a, b: b.update(bindings={"role": "roles/owner"}))

    def test_cli_is_local_and_never_prints_service_accounts(self):
        with tempfile.TemporaryDirectory() as directory:
            data = fixture()
            paths = []
            for n, item in enumerate(data):
                path = Path(directory) / f"input-{n}.json"
                path.write_text(json.dumps(item), encoding="utf-8")
                paths.append(path)
            cmd = [
                sys.executable, str(Path(__file__).with_name("iam_audit.py")),
                "--service-json", str(paths[0]),
                "--service-iam-json", str(paths[1]),
                "--project-iam-json", str(paths[2]),
                "--caller", CALLER,
            ]
            completed = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertNotIn(CALLER, completed.stdout)
            self.assertNotIn(READER, completed.stdout)
            self.assertFalse(json.loads(completed.stdout)["googlePlayReleaseAuthorized"])
            data[1]["bindings"][0]["members"].append("allUsers")
            paths[1].write_text(json.dumps(data[1]), encoding="utf-8")
            denied = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
            self.assertEqual(denied.returncode, 2)
            self.assertIn("invoker_binding_not_exclusive",
                          json.loads(denied.stdout)["issues"])


if __name__ == "__main__":
    unittest.main()
