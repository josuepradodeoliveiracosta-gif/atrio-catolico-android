import unittest
from unittest.mock import Mock,patch
from scripts import guardian_qa_remote_readonly_audit as a

def baseline():
    return {
        "project":{"projectId":a.PROJECT,"projectNumber":a.NUMBER},
        "billing":{"billingEnabled":False},
        "account":{"email":a.ACCOUNT},
        "keys":[],
        "project_iam":{"bindings":[{"role":"roles/datastore.viewer","members":[a.MEMBER]}]},
        "account_iam":{"bindings":[{"role":"roles/iam.workloadIdentityUser","members":[f"principalSet://iam.googleapis.com/projects/{a.NUMBER}/locations/global/workloadIdentityPools/{a.POOL}/attribute.repository/{a.REPO}"]}]},
        "pool":{"state":"ACTIVE"},
        "providers":[{"name":a.PROVIDER_PATH,"state":"ACTIVE"}],
        "provider":{"name":a.PROVIDER_PATH,"state":"ACTIVE","oidc":{"issuerUri":"https://token.actions.githubusercontent.com"},"attributeMapping":{"google.subject":"assertion.sub"},"attributeCondition":"assertion.repository != ''"},
        "ancestors":[{"type":"project","id":a.NUMBER}],
        "environment":{"name":a.ENV,"deployment_branch_policy":{"custom_branch_policies":True,"protected_branches":False}},
        "branches":{"total_count":1,"branch_policies":[{"type":"branch","name":a.BRANCH}]},
        "variables":{"total_count":0,"variables":[]},
        "repository_variables":{"total_count":4,"variables":[{"name":k,"value":v} for k,v in a.EXPECTED_VARS.items()]},
    }

class Audit(unittest.TestCase):
    def test_fixture_never_go(self):
        result=a.evaluate(baseline())
        self.assertEqual(sum(v=="OK" for v in result.values()),14)
        self.assertEqual(result["decisao"],"NO_GO_ESCRITA")
        self.assertEqual(result["cel_semantica_e_iam_efetivo"],"NAO_ATESTADO")
    def test_wrong_project_stops_before_all_other_reads(self):
        q=Mock(return_value={"projectId":"atrio-catolico","projectNumber":"1"})
        self.assertEqual(set(a.collect(q)),{"project"})
        self.assertEqual(q.call_count,1)
    def test_missing_data_inconclusive(self):
        self.assertEqual(a.evaluate({})["projeto_qa_exato"],"INCONCLUSIVO")
        self.assertEqual(a.evaluate({})["decisao"],"NO_GO_ESCRITA")
    def test_billing(self):
        d=baseline();d["billing"]["billingEnabled"]=True
        self.assertEqual(a.evaluate(d)["faturamento_desativado"],"REVISAR")
    def test_extra_write_role(self):
        d=baseline();d["project_iam"]["bindings"].append({"role":"roles/datastore.user","members":[a.MEMBER]})
        self.assertEqual(a.evaluate(d)["papel_direto_apenas_viewer"],"REVISAR")
    def test_account_binding_broad(self):
        d=baseline();d["account_iam"]["bindings"][0]["members"]=["allUsers"]
        self.assertEqual(a.evaluate(d)["vinculo_direto_wif_restrito"],"REVISAR")
    def test_user_key(self):
        d=baseline();d["keys"]=[{"name":"key"}]
        self.assertEqual(a.evaluate(d)["sem_chaves_usuario"],"REVISAR")
    def test_other_provider(self):
        d=baseline();d["providers"].append({"name":"other","state":"ACTIVE"})
        self.assertEqual(a.evaluate(d)["um_provedor_no_pool"],"REVISAR")
    def test_no_cel(self):
        d=baseline();d["provider"]["attributeCondition"]=""
        self.assertEqual(a.evaluate(d)["condicao_cel_presente"],"REVISAR")
    def test_ancestor(self):
        d=baseline();d["ancestors"].append({"type":"organization","id":"1"})
        self.assertEqual(a.evaluate(d)["sem_ancestral_pasta_org"],"REVISAR")
    def test_main_branch_denied(self):
        d=baseline();d["branches"]["branch_policies"][0]["name"]="main"
        self.assertEqual(a.evaluate(d)["branches_qa_exatas"],"REVISAR")
    def test_variable_wrong_project(self):
        d=baseline();d["repository_variables"]["variables"][0]["value"]="atrio-catolico"
        self.assertEqual(a.evaluate(d)["variaveis_qa_exatas"],"REVISAR")
    def test_truncated_variables(self):
        d=baseline();d["variables"]["total_count"]=5
        self.assertEqual(a.evaluate(d)["variaveis_qa_exatas"],"INCONCLUSIVO")
    def test_ancestor_project_id(self):
        d=baseline();d["ancestors"][0]["id"]=a.PROJECT
        self.assertEqual(a.evaluate(d)["sem_ancestral_pasta_org"],"OK")
    def test_ancestor_other_id(self):
        d=baseline();d["ancestors"][0]["id"]="other-project"
        self.assertEqual(a.evaluate(d)["sem_ancestral_pasta_org"],"REVISAR")
    def test_ancestor_requires_verified_project(self):
        d=baseline();d["project"]["projectId"]="other-project"
        self.assertEqual(a.evaluate(d)["sem_ancestral_pasta_org"],"REVISAR")
    def test_environment_override_conflict(self):
        d=baseline();d["variables"]={"total_count":1,"variables":[{"name":"GUARDIAN_QA_FIREBASE_PROJECT_ID","value":"atrio-catolico"}]}
        self.assertEqual(a.evaluate(d)["variaveis_qa_exatas"],"REVISAR")
    def test_environment_matching_override(self):
        d=baseline();d["variables"]={"total_count":1,"variables":[{"name":"GUARDIAN_QA_FIREBASE_PROJECT_ID","value":a.PROJECT}]}
        self.assertEqual(a.evaluate(d)["variaveis_qa_exatas"],"OK")
    def test_missing_repo_scope(self):
        d=baseline();del d["repository_variables"]
        self.assertEqual(a.evaluate(d)["variaveis_qa_exatas"],"INCONCLUSIVO")
    def test_incomplete_repo_scope(self):
        d=baseline();d["repository_variables"]["total_count"]=5
        self.assertEqual(a.evaluate(d)["variaveis_qa_exatas"],"INCONCLUSIVO")
    def test_commands_read_only(self):
        q=Mock(side_effect=[baseline()["project"]]+[None]*13)
        a.collect(q)
        for call in q.call_args_list:
            args=call.args[0]
            if args[0]=="gcloud":
                self.assertIn("--project="+a.PROJECT,args)
                self.assertTrue(set(args)&{"describe","get-ancestors","get-iam-policy","list"})
            else:
                self.assertEqual(args[1:4],["api","--method","GET"])
    def test_read_error_sanitized(self):
        with patch.object(a.subprocess,"run",side_effect=OSError("private")):
            self.assertIsNone(a.read(["gcloud"]))
if __name__=="__main__":
    unittest.main()
