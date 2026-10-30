import importlib.util
import io
import contextlib
import pathlib
import unittest
from unittest.mock import patch
p=pathlib.Path(__file__).with_name("qa-auth-termux.py")
spec=importlib.util.spec_from_file_location("qa_auth_termux",p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Check(unittest.TestCase):
 def test_project_mismatch_prevents_creating_account(self):
  with patch.object(m,"call",return_value=(200,{"projectId":"atrio-catolico"})) as c,patch.object(m,"qa_key_from_firebase_cli",return_value="A"*34),patch("sys.argv",["qa-auth-termux.py","--test"]):
   self.assertEqual(m.main(),1)
   self.assertEqual(c.call_count,1)
 def test_readonly_default(self):
  with patch.object(m,"call",return_value=(200,{"projectId":m.PROJECT})) as c,patch.object(m,"qa_key_from_firebase_cli",return_value="A"*34),patch("sys.argv",["qa-auth-termux.py"]):
   self.assertEqual(m.main(),0)
   self.assertEqual(c.call_args.args[0],"GET")
 def test_auth_project_numeric_identity_matches_exact_qa(self):
  # Identity Toolkit legacy getProjects may report numeric project identifier.
  with patch.object(m,"qa_key_from_firebase_cli",return_value="A"*34),patch.object(
    m,"call",return_value=(200,{"projectId":m.PROJECT_NUMBER,
                                 "authorizedDomains":["atrio-catolico-qa-v2.firebaseapp.com"]})) as api,patch(
    "sys.argv",["qa-auth-termux.py"]),contextlib.redirect_stdout(io.StringIO()) as out:
   self.assertEqual(m.main(),0)
   self.assertEqual(api.call_count,1)
   self.assertIn("QA_PRECHECK_PASS:",out.getvalue())
 def test_foreign_numeric_project_number_is_still_denied(self):
  with patch.object(m,"qa_key_from_firebase_cli",return_value="A"*34),patch.object(
    m,"call",return_value=(200,{"projectId":"999888777666"})) as api,patch(
    "sys.argv",["qa-auth-termux.py","--test"]),contextlib.redirect_stdout(io.StringIO()) as out:
   self.assertEqual(m.main(),1)
   self.assertEqual(api.call_count,1)
   self.assertIn("OTHER_PROJECT_NUMBER",out.getvalue())
   self.assertNotIn("QA_PRECHECK_PASS:",out.getvalue())
 def test_auth_config_without_project_id_accepts_exact_qa_cli_identity(self):
  # A public Auth config can omit projectId while the Firebase Management
  # SDK config has already proved exact appId+projectId+apiKey.
  with patch.object(m,"qa_key_from_firebase_cli",return_value="A"*34),patch.object(
    m,"call",return_value=(200,{"authorizedDomains":["atrio-catolico-qa-v2.firebaseapp.com"]})) as api,patch(
    "sys.argv",["qa-auth-termux.py"]),contextlib.redirect_stdout(io.StringIO()) as out:
   self.assertEqual(m.main(),0)
   self.assertEqual(api.call_count,1)
   self.assertIn("QA_PRECHECK_PASS:",out.getvalue())
 def test_auth_config_malformed_empty_or_explicit_other_project_is_blocked(self):
  for body in [{},{"projectId":"atrio-catolico"},{"projectId":""},["not-an-object"]]:
   with patch.object(m,"qa_key_from_firebase_cli",return_value="A"*34),patch.object(
     m,"call",return_value=(200,body)) as api,patch(
     "sys.argv",["qa-auth-termux.py","--test"]),contextlib.redirect_stdout(io.StringIO()) as out:
    self.assertEqual(m.main(),1)
    self.assertEqual(api.call_count,1)
    self.assertNotIn("QA_PRECHECK_PASS:",out.getvalue())
 def test_provider_disabled(self):
  with patch.object(m,"call",return_value=(400,{"error":{"message":"OPERATION_NOT_ALLOWED"}})) as c:
   self.assertEqual(m.test_qa("A"*34,"example@example.com","password"),1)
   self.assertEqual(c.call_count,1)
 def test_success_and_cleanup(self):
  actions=[]
  def response(method,url,data=None,token=None):
   actions.append(method)
   if "accounts:signUp" in url:return (200,{"idToken":"T"*120,"localId":"x"})
   if "accounts:signInWithPassword" in url:return (200,{"idToken":"R"*120,"localId":"x"})
   if "accounts:delete" in url:return (200,{})
   if "firestore.googleapis" in url:
    return (200,{"name":m.DOC,"fields":{"qaFixture":{"booleanValue":True}}}) if token else (403,{})
   raise AssertionError(url)
  with patch.object(m,"call",side_effect=response),contextlib.redirect_stdout(io.StringIO()) as out:
   self.assertEqual(m.test_qa("A"*34,"test@example.com","password"),0)
  self.assertEqual(actions,["POST","POST","GET","GET","POST"])
  self.assertIn("QA_TEST_ACCOUNT_REMOVED: YES",out.getvalue())
  self.assertNotIn("T"*120,out.getvalue())
 def test_read_without_login_must_fail_and_cleanup(self):
  actions=[]
  def response(method,url,data=None,token=None):
   actions.append(url)
   if "accounts:signUp" in url:return (200,{"idToken":"T"*120,"localId":"x"})
   if "accounts:signInWithPassword" in url:return (200,{"idToken":"T"*120,"localId":"x"})
   if "accounts:delete" in url:return (200,{})
   if "firestore.googleapis" in url:return (200,{})
   raise AssertionError(url)
  with patch.object(m,"call",side_effect=response):
   self.assertEqual(m.test_qa("A"*34,"test@example.com","password"),1)
  self.assertEqual(sum("accounts:delete" in x for x in actions),1)
 def test_get_key_from_exact_qa_web_app(self):
  import json
  from types import SimpleNamespace
  cfg={"status":"success","result":{"sdkConfig":{"projectId":m.PROJECT,"appId":m.APP_ID,"apiKey":"A"*35}}}
  with patch.object(m.subprocess,"run",return_value=SimpleNamespace(returncode=0,stdout=json.dumps(cfg))) as cmd:
   self.assertEqual(m.qa_key_from_firebase_cli(),"A"*35)
   command=cmd.call_args.args[0]
   self.assertEqual(command[0],"firebase")
   self.assertIn("--project",command)
   self.assertNotIn("atrio-catolico",command)
 def test_qa_key_fail_closed_for_wrong_app_project_and_cli_error(self):
  import json
  from types import SimpleNamespace
  for payload in [{"status":"success","result":{"sdkConfig":{"projectId":"atrio-catolico","appId":m.APP_ID,"apiKey":"A"*35}}},
                  {"status":"success","result":{"sdkConfig":{"projectId":m.PROJECT,"appId":"another","apiKey":"A"*35}}},
                  {"status":"error","error":"NO_AUTH"}]:
   with patch.object(m.subprocess,"run",return_value=SimpleNamespace(returncode=0,stdout=json.dumps(payload))):
    self.assertIsNone(m.qa_key_from_firebase_cli())
 def test_http400_public_auth_config_is_not_wrong_project_and_makes_no_user(self):
  with patch.object(m,"qa_key_from_firebase_cli",return_value="A"*35),patch.object(
    m,"call",return_value=(400,{"error":{"message":"HTTP_ERROR"}})) as c,patch(
    "sys.argv",["qa-auth-termux.py","--test"]),contextlib.redirect_stdout(io.StringIO()) as out:
   self.assertEqual(m.main(),1)
   self.assertEqual(c.call_count,1)
   self.assertIn("QA_PROJECT_VERIFIED:",out.getvalue())
   self.assertIn("QA_AUTH_CONFIGURATION_PENDING:",out.getvalue())
   self.assertIn("QA_AUTH_ACTION:",out.getvalue())
   self.assertNotIn("A"*35,out.getvalue())
 def test_bridge_requires_explicit_test_opt_in(self):
  with patch("sys.argv",["qa-auth-termux.py","--bridge-local"]),patch.object(
    m,"qa_key_from_firebase_cli",side_effect=AssertionError("no Firebase")):
   self.assertEqual(m.main(),1)
 def test_local_bridge_invoked_with_id_token_and_account_cleanup(self):
  actions=[]
  def response(method,url,data=None,token=None):
   actions.append(method)
   if "accounts:signUp" in url:return (200,{"idToken":"T"*120,"localId":"x"})
   if "accounts:signInWithPassword" in url:return (200,{"idToken":"R"*120,"localId":"x"})
   if "accounts:delete" in url:return (200,{})
   if "firestore.googleapis" in url:
    return (200,{"name":m.DOC,"fields":{"qaFixture":{"booleanValue":True}}}) if token else (403,{})
   raise AssertionError(url)
  with patch.object(m,"call",side_effect=response),patch.object(m,"qa_bridge_local",return_value=True) as probe,contextlib.redirect_stdout(io.StringIO()):
   self.assertEqual(m.test_qa("A"*34,"temp@example.com","fake_password_123",bridge_local=True),0)
  probe.assert_called_once_with("R"*120)
  self.assertEqual(actions,["POST","POST","GET","GET","POST"])
 def test_failed_local_bridge_still_deletes_account(self):
  actions=[]
  def response(method,url,data=None,token=None):
   actions.append(url)
   if "accounts:signUp" in url:return (200,{"idToken":"T"*120,"localId":"x"})
   if "accounts:signInWithPassword" in url:return (200,{"idToken":"R"*120,"localId":"x"})
   if "accounts:delete" in url:return (200,{})
   if "firestore.googleapis" in url:
    return (200,{"name":m.DOC,"fields":{"qaFixture":{"booleanValue":True}}}) if token else (403,{})
   raise AssertionError(url)
  with patch.object(m,"call",side_effect=response),patch.object(m,"qa_bridge_local",return_value=False):
   self.assertEqual(m.test_qa("A"*34,"temp@example.com","fake_password_123",bridge_local=True),1)
  self.assertEqual(sum("accounts:delete" in x for x in actions),1)
 def test_bridge_runs_without_printing_or_persisting_id_token(self):
  from types import SimpleNamespace
  with patch.object(m.pathlib.Path,"is_file",return_value=True),patch.object(
    m.subprocess,"run",return_value=SimpleNamespace(returncode=0,stdout="QA_BRIDGE_LOCAL_PASS: qa_fixture_clear\n")) as sp,contextlib.redirect_stdout(io.StringIO()) as out:
   assert m.qa_bridge_local("T"*120)
  self.assertEqual(sp.call_args.kwargs["input"],"T"*120)
  self.assertNotIn("T"*120,out.getvalue())
 def test_remote_mode_requires_explicit_test_and_excludes_local(self):
  for args in [["--bridge-remote"],["--bridge-local","--bridge-remote","--test"]]:
   with patch("sys.argv",["qa-auth-termux.py",*args]),patch.object(
     m,"qa_key_from_firebase_cli",side_effect=AssertionError("no auth")):
    self.assertEqual(m.main(),1)
 def test_remote_preflight_disabled_creates_no_account(self):
  with patch.object(m,"qa_key_from_firebase_cli",return_value="A"*35),patch.object(
    m,"call",return_value=(200,{"projectId":m.PROJECT})) as api,patch.object(
    m,"qa_worker_post",return_value=(503,"qa_bridge_disabled")) as probe,patch(
    "sys.argv",["qa-auth-termux.py","--test","--bridge-remote"]),patch.object(
    m,"input",side_effect=AssertionError("must not prompt")),contextlib.redirect_stdout(io.StringIO()) as out:
   self.assertEqual(m.main(),1)
  self.assertEqual(api.call_count,1)
  probe.assert_called_once_with()
  self.assertIn("QA_BRIDGE_REMOTE_DISABLED",out.getvalue())
 def test_remote_probes_fails_closed_for_bad_status(self):
  with patch.object(m,"qa_worker_post",return_value=(200,"qa_fixture_clear")):
   self.assertFalse(m.qa_remote_preflight())
  with patch.object(m,"qa_worker_post",return_value=(401,"unauthorized")):
   self.assertTrue(m.qa_remote_preflight())
 def test_worker_request_uses_pinned_host_and_rejects_redirect(self):
  import urllib.error
  class FakeOpener:
   def __init__(self):self.request=None
   def open(self,req,timeout):
    self.request=req
    raise urllib.error.HTTPError(req.full_url,302,"redirect",
      {"Location":"https://untrusted.invalid/"},io.BytesIO(b''))
  opener=FakeOpener()
  jwt="a"*32+"."+"b"*48+"."+"c"*64
  with contextlib.redirect_stdout(io.StringIO()) as out:
   status=m.qa_worker_post(jwt,opener=opener)
  self.assertEqual(status,(0,"qa_remote_invalid_response"))
  self.assertEqual(opener.request.full_url,m.QA_BRIDGE_URL)
  self.assertEqual(opener.request.get_method(),"POST")
  self.assertEqual(opener.request.get_header("Authorization"),"Bearer "+jwt)
  self.assertEqual(opener.request.data,b"")
  self.assertNotIn(jwt,out.getvalue())
  self.assertIsNone(m.NeverFollowRedirect().redirect_request(
    opener.request,None,302,"redirect",{"Location":"https://untrusted.invalid/"},
    "https://untrusted.invalid/"))
 def test_remote_response_accepts_only_known_categories_without_body_leak(self):
  import json
  class Response:
   def __init__(self,status,text):self.status=status;self._b=io.BytesIO(text.encode())
   def read(self,n):return self._b.read(n)
   def __enter__(self):return self
   def __exit__(self,*a):return None
  class Opener:
   def __init__(self,status,text):self.status=status;self.text=text
   def open(self,req,timeout):return Response(self.status,self.text)
  jwt="a"*32+"."+"b"*48+"."+"c"*64
  self.assertEqual(m.qa_worker_post(jwt,Opener(200,json.dumps({"status":"qa_fixture_clear"}))),
                   (200,"qa_fixture_clear"))
  self.assertEqual(m.qa_worker_post(jwt,Opener(200,json.dumps({"status":"admin_created"}))),
                   (0,"qa_remote_invalid_response"))
  self.assertEqual(m.qa_worker_post("invalid",Opener(200,"{}")),(0,"qa_invalid_token"))
 def test_remote_success_and_failure_both_delete_temporary_account(self):
  actions=[]
  def response(method,url,data=None,token=None):
   actions.append(url)
   if "accounts:signUp" in url:return (200,{"idToken":"T"*120,"localId":"x"})
   if "accounts:signInWithPassword" in url:return (200,{"idToken":"R"*120,"localId":"x"})
   if "accounts:delete" in url:return (200,{})
   if "firestore.googleapis" in url:
    return (200,{"name":m.DOC,"fields":{"qaFixture":{"booleanValue":True}}}) if token else (403,{})
   raise AssertionError(url)
  for ok in [True,False]:
   actions.clear()
   with patch.object(m,"call",side_effect=response),patch.object(
    m,"qa_bridge_remote",return_value=ok) as remote,contextlib.redirect_stdout(io.StringIO()) as out:
    self.assertEqual(m.test_qa("A"*34,"temp@example.com","pw_temp1234",bridge_remote=True),0 if ok else 1)
   remote.assert_called_once_with("R"*120)
   self.assertEqual(sum("accounts:delete" in x for x in actions),1)
   self.assertNotIn("R"*120,out.getvalue())
if __name__=="__main__":unittest.main()
