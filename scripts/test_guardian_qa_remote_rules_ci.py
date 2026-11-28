import sys
from pathlib import Path
import unittest
from unittest.mock import Mock,MagicMock
sys.path.insert(0,str(Path(__file__).resolve().parent))
import guardian_qa_remote_rules_ci as m
from guardian_qa_prepare_disabled_identities import Stop

class RemoteRules(unittest.TestCase):
    def env(self):
        return dict(m.EXPECTED,GITHUB_SHA="a"*40)
    def test_context(self):
        m.validate(self.env())
        for key in m.EXPECTED:
            d=self.env();d[key]="other"
            with self.assertRaises(Stop):m.validate(d)
    def test_credentials_denied(self):
        d=self.env();d["GOOGLE_APPLICATION_CREDENTIALS"]="private.json"
        with self.assertRaises(Stop):m.validate(d)
    def test_billing_stops_before_rules(self):
        f=Mock(return_value={"projectId":m.PROJECT,"billingEnabled":True})
        with self.assertRaises(Stop):m.fetch_rules(f)
        self.assertEqual(f.call_count,1)
    def test_only_three_gets(self):
        name=f"projects/{m.PROJECT}/rulesets/x"
        f=Mock(side_effect=[{"projectId":m.PROJECT,"billingEnabled":False},
            {"name":f"projects/{m.PROJECT}/releases/cloud.firestore","rulesetName":name},
            {"name":name,"source":{"files":[{"content":"private rules"}]}}])
        self.assertEqual(m.fetch_rules(f),b"private rules")
        self.assertEqual(f.call_count,3)
        self.assertTrue(all(c.args[0]=="GET" for c in f.call_args_list))
    def test_allowlist_and_consumer(self):
        opener=Mock();res=MagicMock()
        res.__enter__.return_value.read.return_value=b'{}'
        opener.open.return_value=res
        f=m.reader("fake_test_token_not_for_network",opener)
        f("GET",m.BILLING);f("GET",m.RULES+"releases/cloud.firestore")
        for c in opener.open.call_args_list:
            self.assertEqual(c.args[0].get_header("X-goog-user-project"),m.PROJECT)
        for method,url in [("POST",m.BILLING),("GET","https://firestore.googleapis.com/v1/projects/x"),("GET",m.RULES+"rulesets/../../other"),("GET",m.RULES+"rulesets/x?foo=y")]:
            with self.assertRaises(Stop):f(method,url)
        self.assertEqual(opener.open.call_count,2)
    def test_sanitized_environment(self):
        d=m.sanitized_env({"PATH":"/bin","JAVA_HOME":"/java","QA_RULES_ACCESS_TOKEN":"secret","ACTIONS_ID_TOKEN_REQUEST_TOKEN":"secret","GITHUB_TOKEN":"secret","GOOGLE_APPLICATION_CREDENTIALS":"secret","GUARDIAN_V2_ENABLED":"true"})
        self.assertEqual(set(d),{"PATH","JAVA_HOME","CI","GCLOUD_PROJECT","GOOGLE_CLOUD_PROJECT"})
    def test_report_does_not_expose_private_logs(self):
        import io
        from contextlib import redirect_stdout
        def fake(args,**kwargs):
            Path(args[-1]).write_text("private candidate")
            kwargs["stdout"].write(b"SECRET_LINE_NOT_FOR_PUBLIC\nRESULTADOS: {\"BASELINE\":0,\"BOUNDARY\":0,\"CANDIDATE\":0}\n")
            return Mock(returncode=0)
        out=io.StringIO()
        with redirect_stdout(out):m.run_regression(b"secret legacy",fake)
        self.assertNotIn("SECRET_LINE",out.getvalue())
        self.assertNotIn("secret legacy",out.getvalue())
        self.assertIn('"CANDIDATE": 0',out.getvalue())
if __name__=="__main__":unittest.main()
