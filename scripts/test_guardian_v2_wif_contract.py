"""Offline WIF source contract; not a live audit of Google Cloud IAM or Firestore."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "provision": "scripts/guardian-v2-provision-wif.sh",
    "writer": ".github/workflows/guardiao-v2-moderator-runner.yml",
    "observer": ".github/workflows/guardiao-v2-prod-runner.yml",
    "cycle": "scripts/guardian-v2-autonomous-cycle.mjs",
    "activation": "scripts/guardian-v2-activate-policy.mjs",
    "gate": "cloudflare/guardian-worker/src/nonpunitive-write-gate.js",
}
REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
WRITER = "guardian-v2-writer@atrio-catolico.iam.gserviceaccount.com"
OBSERVER = "guardian-v2-runner@atrio-catolico.iam.gserviceaccount.com"
ENV = "guardian-v2-production-moderation"
PERMS = ("datastore.databases.get,datastore.entities.get,"
         "datastore.entities.list,datastore.entities.create,datastore.entities.update")


def checkout_sources():
    return {k: (ROOT / path).read_text(encoding="utf-8")
            for k, path in FILES.items()}


def contract_errors(s):
    """Return only policy names: never print source, credentials or user data."""
    errors = []
    p, w, o, c, a, gate = (s[k] for k in FILES)

    def check(ok, rule):
        if not ok:
            errors.append(rule)

    check('REPO_ID="1432799501"' in p and
          'OWNER_ID="347622360"' in p, "immutable_repo_owner_ids")
    check('REPO="' + REPO + '"' in p and
          'POOL="guardian-v2-writer"' in p and
          'PROVIDER="github-moderator"' in p, "writer_origin")
    check('SA="guardian-v2-writer@' in p and
          'WORKFLOW="' + "$" + "{REPO}/.github/workflows/"
          "guardiao-v2-moderator-runner.yml@refs/heads/main" + '"' in p,
          "writer_workflow_identity")

    condition_lines = [line for line in p.splitlines()
                       if line.startswith('CONDITION="') and line.endswith('"')]
    parts = (condition_lines[0][len('CONDITION="'):-1].split(" && ")
             if len(condition_lines) == 1 else [])
    required = {
        "assertion.repository_id=='" + "$" + "{REPO_ID}'",
        "assertion.repository_owner_id=='" + "$" + "{OWNER_ID}'",
        "assertion.ref=='refs/heads/main'",
        "assertion.workflow_ref=='" + "$" + "{WORKFLOW}'",
        "assertion.environment=='" + ENV + "'",
    }
    check(len(parts) == 5 and set(parts) == required,
          "exact_provider_condition")
    check("attribute.repository_id=assertion.repository_id" in p and
          "google.subject=assertion.sub" in p and
          "/attribute.repository_id/" in p, "numeric_principal_binding")
    check('PERMISSIONS="' + PERMS + '"' in p and
          len([line for line in p.splitlines()
               if line.startswith('PERMISSIONS=')]) == 1,
          "no_firestore_delete_or_admin")
    check('"--apply"' in p and
          '[[ "$ACTIVE" == "$PROJECT" ]]' in p and
          '[[ "$NUMBER" == "$PROJECT_NUMBER" ]]' in p,
          "manual_provisioning_project_guard")
    check('[[ "$EXISTING" == "$EXPECTED" ]]' in p and
          '[[ "$ACTUAL" == "$CONDITION" ]]' in p,
          "fail_closed_existing_cloud_roles")

    check(w.count("      id-token: write") == 2 and
          "permissions:\n  contents: read" in w,
          "job_level_oidc_only")
    # Require immutable, explicitly reviewed upstream action commits for both jobs.
    # SHA pins were checked against upstream tag refs; the tests remain offline.
    approved_actions = {
        "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
        "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
        "google-github-actions/auth": "7c6bc770dae815cd3e89ee6cdf493a5fab2cc093",
    }
    # YAML permits both "- uses: action@sha" and "uses: action@sha"
    # (the latter when the step also declares a name/id).
    used_actions = [line.strip().removeprefix("- ").removeprefix("uses: ").split(" #", 1)[0]
                    for line in w.splitlines()
                    if line.strip().removeprefix("- ").startswith("uses: ")]
    allowed_actions = [name + "@" + sha
                       for name, sha in approved_actions.items()
                       for _ in range(2)]
    check(sorted(used_actions) == sorted(allowed_actions),
          "approved_action_commit_pins")

    check(w.count("    environment: " + ENV) == 2,
          "writer_environment")
    check(w.count("      access_token_lifetime: 300s") == 2 and
          w.count("      create_credentials_file: false") == 2,
          "temporary_tokens_no_credentials_file")
    check(w.count("          persist-credentials: false") == 2 and
          w.count("          service_account: " + WRITER) == 2 and
          w.count("providers/github-moderator") == 2,
          "dedicated_identity_checkout")
    check("  schedule:\n" in w and "  workflow_dispatch:\n" in w and
          "\n  pull_request:\n" not in w and "\n  push:\n" not in w,
          "schedule_or_manual_only")
    check(w.count("vars.GUARDIAN_V2_WRITER_ENABLED == 'true'") == 2 and
          w.count("vars.GUARDIAN_V2_WRITER_APPROVED == 'true'") == 2 and
          w.count("github.ref == 'refs/heads/main'") == 2,
          "writer_approved_main_only")
    activate_job = w.split("  activate-policy:", 1)[-1].split(
        "    name:", 1)[0]
    check("inputs.confirm_policy_activation == true" in activate_job and
          "github.event_name == 'workflow_dispatch'" in activate_job,
          "activation_job_manual_only")
    check("GUARDIAN_V2_NONPUNITIVE_ONLY: 'true'" in w and
          "GUARDIAN_V2_HOLD_ENABLED: 'false'" in w,
          "nonpunitive_writer_only")

    check(OBSERVER in o and WRITER not in o and
          "GUARDIAN_V2_WRITE_ENABLED: 'false'" in o and
          "GUARDIAN_V2_SHADOW_ONLY: 'true'" in o,
          "observer_separate_read_only")
    check("GITHUB_WORKFLOW_REF" in c and
          "GUARDIAN_V2_WRITER_APPROVED" in c and
          "GUARDIAN_V2_NONPUNITIVE_ONLY" in c and
          "GITHUB_RUN_ATTEMPT" in c,
          "runtime_restricts_context")
    check("enforceNonpunitiveBatch(writes" in c and
          "verify:policy.name" in c and
          "policyApproved(await db.get('guardian_config/policy'))" in c,
          "nonpunitive_write_and_policy_cas")
    check("MAX_CASES_PER_DAY = 12" in c and
          "MAX_CASES_PER_CYCLE = 2" in c,
          "case_budget")
    check("writes.length !== 4" in gate and
          "currentDocument.exists !== false" in gate,
          "strict_write_batch_shape")
    check("e.GITHUB_EVENT_NAME!=='workflow_dispatch'" in a and
          "GUARDIAN_V2_CONFIRM_POLICY_ACTIVATION" in a and
          "currentDocument.updateTime" in a,
          "policy_activation_requires_manual_cas")
    return errors


class GuardianWifSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sources = checkout_sources()

    def test_committed_configuration_passes_offline(self):
        self.assertEqual(contract_errors(self.sources), [])

    def blocked(self, key, old, new, expected):
        self.assertIn(old, self.sources[key])
        s = dict(self.sources)
        s[key] = s[key].replace(old, new, 1)
        self.assertIn(expected, contract_errors(s))

    def test_writer_action_sha_pins_cannot_revert_to_tags(self):
        self.blocked("writer", "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
                     "actions/checkout@v4", "approved_action_commit_pins")
        self.blocked("writer", "google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093",
                     "google-github-actions/auth@v3", "approved_action_commit_pins")

    def test_writer_action_sha_cannot_be_replaced(self):
        self.blocked("writer", "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
                     "actions/setup-node@0000000000000000000000000000000000000000",
                     "approved_action_commit_pins")

    def test_owner_id_cannot_change_silently(self):
        self.blocked("provision", 'OWNER_ID="347622360"',
                     'OWNER_ID="123"', "immutable_repo_owner_ids")

    def test_provider_cannot_drop_repository_id(self):
        self.blocked("provision", "assertion.repository_id",
                     "assertion.repository_name", "exact_provider_condition")

    def test_provider_cannot_drop_workflow_ref(self):
        self.blocked("provision", "assertion.workflow_ref",
                     "assertion.workflow_name", "exact_provider_condition")

    def test_provider_cannot_drop_environment(self):
        self.blocked("provision", "assertion.environment",
                     "assertion.other_environment", "exact_provider_condition")

    def test_cannot_grant_firestore_delete(self):
        self.blocked("provision", "datastore.entities.update\"",
                     "datastore.entities.update,datastore.entities.delete\"",
                     "no_firestore_delete_or_admin")

    def test_existing_provider_cannot_skip_comparison(self):
        self.blocked("provision", '[[ "$ACTUAL" == "$CONDITION" ]]',
                     '[[ "$ACTUAL" != "$CONDITION" ]]',
                     "fail_closed_existing_cloud_roles")

    def test_writer_cannot_lose_environment(self):
        self.blocked("writer", "environment: " + ENV,
                     "environment: unrelated", "writer_environment")

    def test_writer_cannot_persist_credentials(self):
        self.blocked("writer", "create_credentials_file: false",
                     "create_credentials_file: true",
                     "temporary_tokens_no_credentials_file")

    def test_writer_cannot_extend_token_lifetime(self):
        self.blocked("writer", "access_token_lifetime: 300s",
                     "access_token_lifetime: 3600s",
                     "temporary_tokens_no_credentials_file")

    def test_writer_cannot_skip_approval(self):
        self.blocked("writer", "vars.GUARDIAN_V2_WRITER_APPROVED == 'true'",
                     "vars.GUARDIAN_V2_WRITER_APPROVED != 'true'",
                     "writer_approved_main_only")

    def test_activation_remains_manual(self):
        self.blocked("activation", "e.GITHUB_EVENT_NAME!=='workflow_dispatch'",
                     "e.GITHUB_EVENT_NAME!=='schedule'",
                     "policy_activation_requires_manual_cas")

    def test_observer_cannot_use_writer_identity(self):
        self.blocked("observer", OBSERVER, WRITER,
                     "observer_separate_read_only")

    def test_runtime_cannot_skip_write_gate(self):
        self.blocked("cycle", "enforceNonpunitiveBatch(writes",
                     "skipNonpunitiveBatch(writes",
                     "nonpunitive_write_and_policy_cas")

    def test_cannot_expand_batch_shape(self):
        self.blocked("gate", "writes.length !== 4",
                     "writes.length > 0", "strict_write_batch_shape")


if __name__ == "__main__":
    unittest.main()
