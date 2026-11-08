"""Regressoes locais com Firebase sintetico, sem qualquer rede."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from scripts.chat_qa_build_gate import QaBuildGateError, validate


class ChatQaBuildGateTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name, "google-services.json")
        self.config = {
            "project_info": {"project_id": "qa-atrio-conversas-2026",
                             "project_number": "123456789"},
            "client": [{
                "client_info": {
                    "mobilesdk_app_id": "1:123456789:android:abc12345",
                    "android_client_info": {"package_name": "br.com.atriocatolico.chatqa"}
                },
                "api_key": [{"current_key": "synthetic-test-value"}]
            }]
        }
        self.save()
        self.kw = {
            "project": "qa-atrio-conversas-2026",
            "app_id": "1:123456789:android:abc12345",
            "worker_url": "https://atrio-chat-qa.demo-account.workers.dev",
            "sha256": self.digest,
        }

    def save(self):
        self.path.write_text(json.dumps(self.config), encoding="utf-8")
        self.digest = hashlib.sha256(self.path.read_bytes()).hexdigest()

    def denied(self, **overrides):
        values = dict(self.kw)
        values.update(overrides)
        with self.assertRaises(QaBuildGateError):
            validate(self.path, **values)

    def changed(self):
        self.save()
        self.kw["sha256"] = self.digest
        self.denied()

    def test_synthetic_qa_config_passes(self):
        self.assertTrue(validate(self.path, **self.kw))

    def test_prod_project_fails(self):
        self.denied(project="atrio-catolico")

    def test_prod_worker_fails(self):
        self.denied(worker_url="https://atrio-push.atrio-catolico.workers.dev")

    def test_worker_without_qa_marker_fails(self):
        self.denied(worker_url="https://atrio-chat.demo-account.workers.dev")

    def test_http_worker_fails(self):
        self.denied(worker_url="http://atrio-chat-qa.demo-account.workers.dev")

    def test_unapproved_app_id_fails(self):
        self.denied(app_id="1:123456789:android:badbeef")

    def test_missing_hash_fails(self):
        self.denied(sha256="")

    def test_wrong_hash_fails(self):
        self.denied(sha256="0"*64)

    def test_missing_file_fails(self):
        self.path.unlink()
        self.denied()

    def test_symlink_fails(self):
        actual = self.path.with_name("config-real.json")
        self.path.rename(actual)
        self.path.symlink_to(actual)
        self.denied()

    def test_different_project_fails(self):
        self.config["project_info"]["project_id"] = "other-qa-project"
        self.changed()

    def test_official_firebase_project_in_config_fails(self):
        self.config["project_info"]["project_id"] = "atrio-catolico"
        self.changed()

    def test_missing_sender_in_config_fails(self):
        self.config["project_info"].pop("project_number")
        self.changed()

    def test_wrong_sender_fails(self):
        self.config["project_info"]["project_number"] = "987654321"
        self.changed()

    def test_wrong_package_fails(self):
        self.config["client"][0]["client_info"]["android_client_info"]["package_name"] = "br.com.atriocatolico"
        self.changed()

    def test_multiple_clients_fail(self):
        self.config["client"].append(self.config["client"][0])
        self.changed()

    def test_missing_api_key_fails(self):
        self.config["client"][0]["api_key"] = []
        self.changed()

    def test_invalid_json_fails(self):
        self.path.write_text("{", encoding="utf-8")
        self.kw["sha256"] = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.denied()


if __name__ == "__main__":
    unittest.main()
