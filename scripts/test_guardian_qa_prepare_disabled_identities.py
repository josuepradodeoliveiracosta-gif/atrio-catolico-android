import unittest
from unittest.mock import Mock, patch, MagicMock
from scripts import guardian_qa_prepare_disabled_identities as m

class Fake:
    def __init__(self):
        self.users={}
        self.writes=[]
    def __call__(self,method,url,body=None):
        if url==m.AUTH+":lookup":
            u=self.users.get(body["localId"][0])
            return {"users":[dict(u)]} if u else {}
        self.writes.append((method,url,body))
        if url==m.AUTH:
            uid=body["localId"]
            assert uid not in self.users
            assert body["disabled"] is True
            self.users[uid]=dict(body)
            return {"localId":uid}
        if url==m.AUTH+":update":
            assert body["disableUser"] is True
            self.users[body["localId"]]["customAttributes"]=body["customAttributes"]
            return {}
        raise AssertionError("unknown endpoint")

class Prepare(unittest.TestCase):
    def test_plan_no_writes(self):
        f=Fake()
        self.assertEqual(set(m.prepare(f,False).values()),{"DISPONIVEL"})
        self.assertEqual(f.writes,[])
    def test_apply_creates_two_disabled_distinct_roles(self):
        f=Fake(); gate=Mock()
        self.assertEqual(set(m.prepare(f,True,gate).values()),{"CRIADA_DESATIVADA"})
        gate.assert_called_once()
        self.assertEqual(len(f.writes),4)
        for uid,role in m.ROLES.items(): self.assertTrue(m.verified(f.users[uid],uid,role))
    def test_repeat_is_noop(self):
        f=Fake(); m.prepare(f,True,lambda:None); f.writes.clear()
        self.assertEqual(set(m.prepare(f,True,lambda:None).values()),{"JA_PREPARADA_DESATIVADA"})
        self.assertEqual(f.writes,[])
    def test_existing_conflict_blocks_both(self):
        f=Fake();f.users["fixture_activation"]={"localId":"fixture_activation","disabled":False}
        with self.assertRaises(m.Stop):m.prepare(f,True,lambda:None)
        self.assertEqual(f.writes,[])
    def test_billing_gate_precedes_writes(self):
        f=Fake()
        with self.assertRaises(m.Stop):m.prepare(f,True,Mock(side_effect=m.Stop("billing")))
        self.assertEqual(f.writes,[])
    def test_wrong_uid_blocks(self):
        f=Mock(return_value={"users":[{"localId":"other"}]})
        with self.assertRaises(m.Stop):m.lookup(f,"fixture_triage")
    def test_active_or_provider_identity_not_adopted(self):
        for key,val in [("disabled",False),("providerUserInfo",[{}]),("lastLoginAt","1"),("email","other@example.invalid")]:
            f=Fake();m.prepare(f,True,lambda:None);f.writes.clear()
            f.users["fixture_triage"][key]=val
            with self.assertRaises(m.Stop):m.prepare(f,True,lambda:None)
            self.assertEqual(f.writes,[])
    def test_snapshot_only_qa_and_single_source(self):
        name=f"projects/{m.PROJECT}/rulesets/test"
        f=Mock(side_effect=[{"name":f"projects/{m.PROJECT}/releases/cloud.firestore","rulesetName":name},{"name":name,"source":{"files":[{"content":"rules"}]}}])
        self.assertEqual(m.snapshot(f),(name,"rules"))
        self.assertEqual(f.call_count,2)
    def test_snapshot_rejects_cross_project(self):
        f=Mock(return_value={"name":f"projects/{m.PROJECT}/releases/cloud.firestore","rulesetName":"projects/atrio-catolico/rulesets/test"})
        with self.assertRaises(m.Stop):m.snapshot(f)
        self.assertEqual(f.call_count,1)
    def test_client_rejects_non_qa_and_redirect(self):
        f=m.client("fake_oauth_token_for_test_only")
        with self.assertRaises(m.Stop):f("POST","https://identitytoolkit.googleapis.com/v1/projects/atrio-catolico/accounts",{})
        with self.assertRaises(m.Stop):m.NoRedirect().redirect_request()
    def test_quota_project_pinned_on_both_services(self):
        opener=Mock()
        response=MagicMock()
        response.__enter__.return_value.read.return_value=b'{}'
        opener.open.return_value=response
        with patch.object(m.urllib.request,"build_opener",return_value=opener):
            f=m.client("fake_oauth_token_for_test_only")
            f("GET",m.RULES+"releases/cloud.firestore")
            f("POST",m.AUTH+":lookup",{"localId":["fixture_triage"]})
        self.assertEqual(opener.open.call_count,2)
        for call in opener.open.call_args_list:
            req=call.args[0]
            self.assertEqual(req.get_header("X-goog-user-project"),m.PROJECT)
    def test_http_error_identifies_stage_without_secret(self):
        opener=Mock()
        opener.open.side_effect=m.urllib.error.HTTPError(m.AUTH+":lookup",403,"private",{},None)
        with patch.object(m.urllib.request,"build_opener",return_value=opener):
            f=m.client("fake_oauth_token_for_test_only")
            with self.assertRaisesRegex(m.Stop,"^auth_lookup_http_403$"):
                f("POST",m.AUTH+":lookup",{"localId":["fixture_triage"]})
if __name__=="__main__": unittest.main()
