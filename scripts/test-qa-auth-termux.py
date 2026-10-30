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
  with patch.object(m,"call",return_value=(200,{"projectId":"atrio-catolico"})) as c,patch.object(m.getpass,"getpass",return_value="A"*34),patch("sys.argv",["qa-auth-termux.py","--test"]):
   self.assertEqual(m.main(),1)
   self.assertEqual(c.call_count,1)
 def test_readonly_default(self):
  with patch.object(m,"call",return_value=(200,{"projectId":m.PROJECT})) as c,patch.object(m.getpass,"getpass",return_value="A"*34),patch("sys.argv",["qa-auth-termux.py"]):
   self.assertEqual(m.main(),0)
   self.assertEqual(c.call_args.args[0],"GET")
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
if __name__=="__main__":unittest.main()
