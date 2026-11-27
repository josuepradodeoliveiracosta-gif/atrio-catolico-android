import io
import json
from datetime import datetime, timezone
import unittest
from urllib.error import HTTPError

from scripts.qa_service_diagnostics import collect, get_json, PROJECTS, WORKERS, MAX_BYTES
from scripts.operational_diagnostic_center import build, markdown
from scripts.test_operational_diagnostic_center import ci, NOW


class QACollectorTests(unittest.TestCase):
    def test_all_firebase_targets_pinned(self):
        for env, project in PROJECTS.items():
            def fetch(url, token):
                self.assertEqual(url, "https://firestore.googleapis.com/v1/projects/" + project + "/databases/(default)")
                return "metadata_confirmed", {"name": "projects/" + project + "/databases/(default)", "private": "DO_NOT_EXPORT"}
            result = collect(env, "firebase", confirmed_target=project, token="fake", fetch=fetch, now=NOW)
            self.assertEqual(result["outcome"], "metadata_confirmed")
            self.assertNotIn("DO_NOT_EXPORT", json.dumps(result))
            self.assertFalse(result["operational_health_verified"])

    def test_wrong_target_production_and_unknown_refused_before_io(self):
        def never(*args):
            self.fail("network reached")
        for env, target in (("production", "atrio-catolico"), ("perfil_qa", PROJECTS["chat_qa"]),
                            ("chat_qa", PROJECTS["qa_geral"]), ("qa_geral", "atrio-catolico")):
            with self.assertRaises(ValueError):
                collect(env, "firebase", confirmed_target=target, token="fake", fetch=never)

    def test_firebase_response_identity(self):
        result = collect("perfil_qa", "firebase", confirmed_target=PROJECTS["perfil_qa"], token="fake",
                         fetch=lambda *_: ("metadata_confirmed", {"name": "projects/atrio-catolico/databases/(default)"}), now=NOW)
        self.assertEqual(result["outcome"], "invalid_response")

    def test_cloudflare_closed_routes(self):
        for env, worker in WORKERS.items():
            def fetch(url, token):
                self.assertEqual(url, "https://api.cloudflare.com/client/v4/accounts/" + "a"*32 + "/workers/scripts/" + worker + "/deployments")
                return "metadata_confirmed", {"success": True, "result": {"deployments": [
                    {"id": "fixture", "versions": [{"version_id": "fixture"}], "author_email": "private@example.invalid"}]}}
            result = collect(env, "cloudflare", confirmed_target=worker, account="a"*32, token="fake", fetch=fetch, now=NOW)
            self.assertEqual(result["outcome"], "metadata_confirmed")
            self.assertNotIn("private@", json.dumps(result))

    def test_cloudflare_rejects_unapproved_account_format_and_worker(self):
        def never(*args):
            self.fail("network reached")
        for env, worker, account in (("chat_qa", "atrio-push", "a"*32),
                                     ("perfil_qa", "atrio-qa-geral", "a"*32),
                                     ("chat_qa", WORKERS["chat_qa"], "a/../")):
            with self.assertRaises(ValueError):
                collect(env, "cloudflare", confirmed_target=worker, account=account, token="fake", fetch=never)

    def test_empty_deployment_not_healthy(self):
        result = collect("chat_qa", "cloudflare", confirmed_target=WORKERS["chat_qa"], account="a"*32, token="fake",
                         fetch=lambda *_: ("metadata_confirmed", {"success": True, "result": {"deployments": []}}), now=NOW)
        self.assertEqual(result["outcome"], "no_deployment_reported")

    def test_http_get_no_secret_output(self):
        def denied(req, timeout):
            self.assertEqual(req.get_method(), "GET")
            self.assertEqual(timeout, 10)
            raise HTTPError(req.full_url, 403, "private message", {}, io.BytesIO(b"private body"))
        self.assertEqual(get_json("https://example.invalid", "fake", denied), ("access_denied", None))

    def test_missing_token_never_calls_transport(self):
        def never(*args, **kwargs):
            self.fail("network reached")
        self.assertEqual(get_json("https://example.invalid", None, never), ("credential_missing", None))

    def test_oversized_and_duplicate_json_rejected(self):
        class Response(io.BytesIO):
            status = 200
        for data in (b"x"*(MAX_BYTES+1), b'{"name":1,"name":2}'):
            self.assertEqual(get_json("https://example.invalid", "fake", lambda *a, **k: Response(data)),
                             ("invalid_response", None))

    def test_imported_metadata_not_promoted_to_health(self):
        receipt = collect("perfil_qa", "firebase", confirmed_target=PROJECTS["perfil_qa"], token="fake",
                          fetch=lambda *_: ("metadata_confirmed", {"name": "projects/"+PROJECTS["perfil_qa"]+"/databases/(default)"}), now=NOW)
        result = build(ci(), now=NOW, qa_receipts=[receipt])
        self.assertEqual(result["qa_metadata"][0]["outcome"], "metadata_confirmed")
        self.assertEqual(result["qa_metadata"][0]["source"], "imported_unverified")
        self.assertFalse(result["operational_health_verified"])
        self.assertIn("metadata_confirmed", markdown(result))
        self.assertTrue(all(x["state"] == "unknown" for x in result["operational"]))
        for forged in (dict(receipt, environment="production"), dict(receipt, token="secret"),
                       dict(receipt, operational_health_verified=True)):
            with self.assertRaises(ValueError):
                build(ci(), now=NOW, qa_receipts=[forged])


if __name__ == "__main__":
    unittest.main()
