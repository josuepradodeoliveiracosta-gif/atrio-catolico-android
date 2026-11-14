#!/usr/bin/env python3
"""Audit deployed Guardian V2 WIF/IAM via read-only gcloud calls.

Only prints safe control names and statuses. It never prints policies, identities,
credentials, command stderr or personal data. No GitHub Actions or Firestore call.
"""
import json
import subprocess
import sys

PROJECT = "atrio-catolico"
NUMBER = "256733686427"
SERVICE_ACCOUNT = f"guardian-v2-writer@{PROJECT}.iam.gserviceaccount.com"
ROLE = f"projects/{PROJECT}/roles/guardianV2CaseWriter"
POOL = "guardian-v2-writer"
REPO_ID = "1432799501"
PRINCIPAL = (
    f"principalSet://iam.googleapis.com/projects/{NUMBER}/locations/global/"
    f"workloadIdentityPools/{POOL}/attribute.repository_id/{REPO_ID}"
)
WORKFLOW = (
    "josuepradodeoliveiracosta-gif/atrio-catolico-android/.github/workflows/"
    "guardiao-v2-moderator-runner.yml@refs/heads/main"
)
CONDITION = " && ".join((
    f"assertion.repository_id=='{REPO_ID}'",
    "assertion.repository_owner_id=='347622360'",
    "assertion.ref=='refs/heads/main'",
    f"assertion.workflow_ref=='{WORKFLOW}'",
    "assertion.environment=='guardian-v2-production-moderation'",
))
PERMISSIONS = {
    "datastore.databases.get", "datastore.entities.get", "datastore.entities.list",
    "datastore.entities.create", "datastore.entities.update",
}

# Fixed commands: all read-only; never accept arbitrary CLI arguments, API paths or tokens.
COMMANDS = {
    "project": ["projects", "describe", PROJECT],
    "pool": ["iam", "workload-identity-pools", "describe", POOL, "--location=global"],
    "provider": ["iam", "workload-identity-pools", "providers", "describe", "github-moderator",
                 f"--workload-identity-pool={POOL}", "--location=global"],
    "role": ["iam", "roles", "describe", "guardianV2CaseWriter"],
    "account": ["iam", "service-accounts", "describe", SERVICE_ACCOUNT],
    "account_policy": ["iam", "service-accounts", "get-iam-policy", SERVICE_ACCOUNT],
    "project_policy": ["projects", "get-iam-policy", PROJECT],
    "user_keys": ["iam", "service-accounts", "keys", "list",
                  f"--iam-account={SERVICE_ACCOUNT}", "--managed-by=user"],
}


class AuditUnavailable(Exception):
    """A read failed; deliberately omit untrusted command output."""


def query_readonly(name):
    cmd = ["gcloud", *COMMANDS[name], f"--project={PROJECT}", "--format=json", "--quiet"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=30, check=False)
        if p.returncode:
            raise AuditUnavailable()
        result = json.loads(p.stdout)
        if not isinstance(result, (dict, list)):
            raise AuditUnavailable()
        return result
    except (OSError, subprocess.TimeoutExpired, UnicodeError, ValueError) as exc:
        raise AuditUnavailable() from exc


def bindings(policy):
    b = policy.get("bindings", []) if isinstance(policy, dict) else []
    return b if isinstance(b, list) else []


def contains_binding(policy, role, member):
    return any(b.get("role") == role and member in b.get("members", [])
               and not b.get("condition") for b in bindings(policy) if isinstance(b, dict))


def evaluate(data):
    """Pure deterministic checks. Statuses are PASS, REVIEW or INCONCLUSIVE."""
    verdicts = {}

    def check(name, keys, predicate):
        if any(k not in data for k in keys):
            verdicts[name] = "INCONCLUSIVO"
            return
        try:
            verdicts[name] = "OK" if predicate() else "REVISAR"
        except (AttributeError, TypeError, KeyError, ValueError):
            verdicts[name] = "INCONCLUSIVO"

    check("projeto_exato", ["project"],
          lambda: data["project"].get("projectId") == PROJECT
          and str(data["project"].get("projectNumber")) == NUMBER)
    check("pool_ativo", ["pool"],
          lambda: data["pool"].get("state") == "ACTIVE" and not data["pool"].get("disabled", False))
    check("provedor_ativo", ["provider"],
          lambda: data["provider"].get("state") == "ACTIVE" and not data["provider"].get("disabled", False))
    check("emissor_oidc", ["provider"],
          lambda: data["provider"].get("oidc", {}).get("issuerUri") ==
          "https://token.actions.githubusercontent.com")
    check("condicao_wif", ["provider"],
          lambda: data["provider"].get("attributeCondition") == CONDITION)
    check("mapeamento_wif", ["provider"],
          lambda: data["provider"].get("attributeMapping", {}).get("google.subject") == "assertion.sub"
          and data["provider"].get("attributeMapping", {}).get("attribute.repository_id") ==
          "assertion.repository_id")
    check("permissoes_papel", ["role"],
          lambda: set(data["role"].get("includedPermissions", [])) == PERMISSIONS
          and not data["role"].get("deleted", False))
    check("conta_ativa", ["account"],
          lambda: data["account"].get("email") == SERVICE_ACCOUNT
          and not data["account"].get("disabled", False))
    check("chaves_usuario_ausentes", ["user_keys"],
          lambda: isinstance(data["user_keys"], list) and len(data["user_keys"]) == 0)
    check("vinculo_wif_conta", ["account_policy"],
          lambda: contains_binding(data["account_policy"], "roles/iam.workloadIdentityUser", PRINCIPAL))
    check("acessos_extras_conta", ["account_policy"],
          lambda: all(b.get("role") == "roles/iam.workloadIdentityUser"
                      and b.get("members") == [PRINCIPAL] and not b.get("condition")
                      for b in bindings(data["account_policy"])))
    check("papel_projeto", ["project_policy"],
          lambda: contains_binding(data["project_policy"], ROLE, f"serviceAccount:{SERVICE_ACCOUNT}"))
    check("papeis_extras_projeto", ["project_policy"],
          lambda: all(b.get("role") == ROLE and not b.get("condition")
                      for b in bindings(data["project_policy"])
                      if f"serviceAccount:{SERVICE_ACCOUNT}" in b.get("members", [])))
    return verdicts


def main():
    data = {}
    # Do not examine resources under a mismatched project number.
    try:
        data["project"] = query_readonly("project")
    except AuditUnavailable:
        pass
    if evaluate(data)["projeto_exato"] != "OK":
        print("AUDITORIA_GUARDIAO_V2: INCONCLUSIVO; identidade do projeto nao confirmada")
        return 2
    for name in COMMANDS:
        if name == "project":
            continue
        try:
            data[name] = query_readonly(name)
        except AuditUnavailable:
            pass
    checks = evaluate(data)
    for name, status in checks.items():
        print(f"{name}: {status}")
    print("LIMITACAO: leitura direta do projeto; heranca IAM, escopo Firestore por colecao ")
    print("e protecoes do ambiente GitHub nao sao atestados por esta ferramenta.")
    print("RISCO_PENDENTE: IAM Firestore de projeto nao limita colecoes por si so.")
    return 0 if all(s == "OK" for s in checks.values()) else 2


if __name__ == "__main__":
    sys.exit(main())
