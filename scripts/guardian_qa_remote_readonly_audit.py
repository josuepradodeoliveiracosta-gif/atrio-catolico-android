#!/usr/bin/env python3
"""Read-only QA V2 admission audit. No tokens, document reads or changes.
Direct policy checks are evidence only; never an effective IAM/WIF attestation.
"""
import json
import subprocess

PROJECT = "atrio-catolico-qa-v2"
NUMBER = "53068022813"
REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
ACCOUNT = f"guardian-qa-reader@{PROJECT}.iam.gserviceaccount.com"
POOL = "guardian-github-qa"
PROVIDER = "github-qa"
PROVIDER_PATH = f"projects/{NUMBER}/locations/global/workloadIdentityPools/{POOL}/providers/{PROVIDER}"
BRANCH = "feature/guardiao-v2-wif-prova-qa-20261030"
ALLOWED_BRANCHES = {BRANCH, "feature/guardiao-autonomo-20261029"}
ENV = "guardian-qa"
MEMBER = "serviceAccount:" + ACCOUNT
GITHUB = f"repos/{REPO}/environments/{ENV}"
# All Google commands are explicitly limited to QA project metadata.
COMMANDS = {
    "project": ["projects", "describe", PROJECT],
    "billing": ["billing", "projects", "describe", PROJECT],
    "ancestors": ["projects", "get-ancestors", PROJECT],
    "account": ["iam", "service-accounts", "describe", ACCOUNT],
    "keys": ["iam", "service-accounts", "keys", "list", "--iam-account=" + ACCOUNT, "--managed-by=user"],
    "account_iam": ["iam", "service-accounts", "get-iam-policy", ACCOUNT],
    "project_iam": ["projects", "get-iam-policy", PROJECT],
    "pool": ["iam", "workload-identity-pools", "describe", POOL, "--location=global"],
    "providers": ["iam", "workload-identity-pools", "providers", "list", "--location=global", "--workload-identity-pool=" + POOL],
    "provider": ["iam", "workload-identity-pools", "providers", "describe", PROVIDER, "--location=global", "--workload-identity-pool=" + POOL],
}
EXPECTED_VARS = {
    "GUARDIAN_QA_FIREBASE_PROJECT_ID": PROJECT,
    "GUARDIAN_QA_APPROVED_PROJECT_ID": PROJECT,
    "GUARDIAN_QA_SERVICE_ACCOUNT": ACCOUNT,
    "GUARDIAN_QA_WIF_PROVIDER": PROVIDER_PATH,
}
def read(args):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=45, check=False)
        if p.returncode or len(p.stdout) > 4_000_000:
            return None
        return json.loads(p.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None

def collect(query=read):
    data = {}
    def google(k):
        return query(["gcloud", *COMMANDS[k], "--project="+PROJECT, "--format=json", "--quiet"])
    data["project"] = google("project")
    project = data["project"]
    if not isinstance(project, dict) or project.get("projectId") != PROJECT or str(project.get("projectNumber")) != NUMBER:
        return data
    for k in COMMANDS:
        if k != "project":
            data[k] = google(k)
    for k, path in {
        "environment": GITHUB,
        "branches": GITHUB+"/deployment-branch-policies?per_page=100",
        "variables": GITHUB+"/variables?per_page=100",
        "repository_variables": f"repos/{REPO}/actions/variables?per_page=100",
    }.items():
        data[k] = query(["gh","api","--method","GET",path])
    return data

def bindings(x):
    b = x["bindings"]
    if not isinstance(b, list) or any(not isinstance(i,dict) or not isinstance(i.get("members"),list) for i in b):
        raise ValueError("invalid_bindings")
    return b

def evaluate(data):
    status = {}
    def check(name, key, fn):
        try:
            obj = data[key]
            status[name] = "OK" if fn(obj) else "REVISAR"
        except (KeyError, TypeError, AttributeError, ValueError):
            status[name] = "INCONCLUSIVO"
    check("projeto_qa_exato","project",lambda d:d["projectId"]==PROJECT and str(d["projectNumber"])==NUMBER)
    check("faturamento_desativado","billing",lambda d:d["billingEnabled"] is False)
    check("conta_qa_ativa","account",lambda d:d["email"]==ACCOUNT and d.get("disabled",False) is False)
    check("sem_chaves_usuario","keys",lambda d:isinstance(d,list) and len(d)==0)
    def direct_read_only(d):
        b=[i for i in bindings(d) if MEMBER in i["members"]]
        return len(b)==1 and b[0]["role"]=="roles/datastore.viewer" and not b[0].get("condition")
    check("papel_direto_apenas_viewer","project_iam",direct_read_only)
    def account_binding(d):
        b=bindings(d)
        prefix=f"principalSet://iam.googleapis.com/projects/{NUMBER}/locations/global/workloadIdentityPools/{POOL}/attribute."
        valid={prefix+"repository/"+REPO,prefix+"repository_id/1432799501"}
        return len(b)==1 and b[0]["role"]=="roles/iam.workloadIdentityUser" and not b[0].get("condition") and len(b[0]["members"])==1 and b[0]["members"][0] in valid
    check("vinculo_direto_wif_restrito","account_iam",account_binding)
    check("pool_ativo","pool",lambda d:d["state"]=="ACTIVE" and not d.get("disabled",False))
    check("um_provedor_no_pool","providers",lambda d:isinstance(d,list) and len(d)==1 and d[0]["name"]==PROVIDER_PATH and d[0]["state"]=="ACTIVE" and not d[0].get("disabled",False))
    check("provedor_oidc_github","provider",lambda d:d["name"]==PROVIDER_PATH and d["state"]=="ACTIVE" and not d.get("disabled",False) and d["oidc"]["issuerUri"]=="https://token.actions.githubusercontent.com" and d["attributeMapping"]["google.subject"]=="assertion.sub")
    check("condicao_cel_presente","provider",lambda d:isinstance(d["attributeCondition"],str) and bool(d["attributeCondition"].strip()))
    # The project was independently verified by projects describe. gcloud
    # ancestry may identify that same project by its ID rather than number.
    check("sem_ancestral_pasta_org","ancestors",lambda d:
          status["projeto_qa_exato"]=="OK" and isinstance(d,list) and len(d)==1
          and d[0]["type"]=="project" and str(d[0]["id"]) in {PROJECT,NUMBER})
    check("ambiente_qa_restrito","environment",lambda d:d["name"]==ENV and d["deployment_branch_policy"]["custom_branch_policies"] is True and d["deployment_branch_policy"]["protected_branches"] is False)
    def branches(d):
        b=d["branch_policies"]
        return len(b)==d["total_count"] and bool(b) and all(i["type"]=="branch" for i in b) and BRANCH in {i["name"] for i in b} and {i["name"] for i in b}<=ALLOWED_BRANCHES
    check("branches_qa_exatas","branches",branches)
    def variable_map(d):
        b=d["variables"]
        if not isinstance(b,list) or len(b)!=d["total_count"] or len({i["name"] for i in b})!=len(b):
            raise ValueError("incomplete_variables")
        return {i["name"]:i["value"] for i in b}
    def variables(d):
        env_vars=variable_map(d)
        repo_vars=variable_map(data["repository_variables"])
        # Require all repository defaults, and reject any conflicting QA
        # environment override regardless of when the runner resolves vars.
        return all(repo_vars.get(k)==v and (k not in env_vars or env_vars[k]==v)
                   for k,v in EXPECTED_VARS.items())
    check("variaveis_qa_exatas","variables",variables)
    # A present CEL expression is not a proven restrictive expression. Direct
    # bindings cannot exclude inherited/group/impersonation paths. Never GO.
    status["cel_semantica_e_iam_efetivo"]="NAO_ATESTADO"
    status["segregacao_triagem_ativacao"]="NAO_ATESTADA"
    status["decisao"]="NO_GO_ESCRITA"
    return status

def main():
    for k,v in evaluate(collect()).items():
        print(f"{k}: {v}")
    print("Somente metadados QA; nenhuma credencial, dado de usuario, deploy ou alteracao.")
    return 2

if __name__=="__main__":
    raise SystemExit(main())
