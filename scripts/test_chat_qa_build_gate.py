"""Regressoes locais com Firebase sintetico, sem qualquer rede."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from scripts.chat_qa_build_gate import QaBuildGateError, validate, sanitized_receipt


class ChatQaBuildGateTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name, "google-services.json")
        self.config = {
            "project_info": {"project_id": "atrio-catolico-qa-geral",
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
            "project": "atrio-catolico-qa-geral",
            "app_id": "1:123456789:android:abc12345",
            "worker_url": "https://atrio-qa-geral.valid-account.workers.dev",
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

    def test_compilar_offline_apenas_sem_worker(self):
        self.assertTrue(validate(self.path, **{**self.kw,
            "worker_url": "", "offline_only": True}))
        self.denied(worker_url="", offline_only=False)
        self.denied(worker_url=self.kw["worker_url"], offline_only=True)
        self.denied(worker_url="https://atrio-push.atrio-catolico.workers.dev",
                    offline_only=True)
        self.denied(worker_url="", offline_only="1")

    def test_comprovante_offline_sem_alegacao_de_servidor(self):
        receipt = sanitized_receipt(self.path, **{**self.kw,
            "worker_url": "", "offline_only": True})
        self.assertTrue(receipt["offline_build_no_worker"])
        self.assertIsNone(receipt["worker_qa_origin"])
        self.assertIn("fcm_delivery_on_physical_devices", receipt["not_verified"])

    def test_rejeita_placeholder_worker(self):
        self.denied(worker_url="https://atrio-qa-geral.demo-account.workers.dev")
        self.denied(worker_url="https://atrio-qa-geral.conta.workers.dev")
        self.denied(worker_url="https://atrio-chat-qa.account.workers.dev")

    def test_synthetic_qa_config_passes(self):
        self.assertTrue(validate(self.path, **self.kw))

    def test_unmarked_nonproduction_project_fails(self):
        self.denied(project="other-atrio-project")

    def test_qa_as_substring_does_not_count(self):
        self.denied(project="squad-atrio-test")

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

    def test_duplicate_project_id_rejected_even_if_last_value_is_qa(self):
        raw = json.dumps(self.config)
        unique = '"project_id": "atrio-catolico-qa-geral"'
        self.assertEqual(raw.count(unique), 1)
        raw = raw.replace(unique, '"project_id": "atrio-catolico", ' + unique)
        self.path.write_text(raw, encoding="utf-8")
        self.kw["sha256"] = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.denied()

    def test_duplicate_nested_client_fields_rejected(self):
        raw = json.dumps(self.config)
        unique = '"package_name": "br.com.atriocatolico.chatqa"'
        self.assertEqual(raw.count(unique), 1)
        raw = raw.replace(unique,
            '"package_name": "br.com.atriocatolico", ' + unique)
        self.path.write_text(raw, encoding="utf-8")
        self.kw["sha256"] = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.denied()

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


    def test_extra_production_storage_reference_fails_even_with_qa_project_id(self):
        self.config["project_info"]["storage_bucket"] = "atrio-catolico.appspot.com"
        self.changed()

    def test_uppercase_production_storage_reference_fails(self):
        self.config["project_info"]["storage_bucket"] = "ATRIO-CATOLICO.APP.SPOT.COM"
        self.changed()

    def test_uppercase_qa_storage_domain_is_not_false_positive(self):
        self.config["project_info"]["storage_bucket"] = (
            "ATRIO-CATOLICO-QA-GERAL.FIREBASESTORAGE.APP"
        )
        self.save()
        self.kw["sha256"] = self.digest
        self.assertTrue(validate(self.path, **self.kw))

    def test_extra_production_oauth_reference_fails_even_with_qa_project_id(self):
        self.config["client"][0]["oauth_client"] = [
            {"client_id": "atrio-catolico.apps.googleusercontent.com"}
        ]
        self.changed()

    def test_qa_storage_bucket_valido(self):
        self.config["project_info"]["storage_bucket"] = (
            "atrio-catolico-qa-geral.firebasestorage.app"
        )
        self.save()
        self.kw["sha256"] = self.digest
        self.assertTrue(validate(self.path, **self.kw))

    def test_qa_storage_bucket_com_producao_invalido(self):
        self.config["project_info"]["storage_bucket"] = (
            "atrio-catolico-qa-geral/atrio-catolico.appspot.com"
        )
        self.changed()

    def test_multiple_api_keys_fail_closed(self):
        self.config["client"][0]["api_key"].append(
            {"current_key": "synthetic-foreign-key"}
        )
        self.changed()

    def test_non_string_api_key_fails_closed(self):
        self.config["client"][0]["api_key"] = [{"current_key": True}]
        self.changed()

    def test_receipt_contains_no_sensitive_config_or_false_end_to_end_claims(self):
        config = self.path.read_text(encoding="utf-8")
        receipt = sanitized_receipt(self.path, **self.kw)
        serialized = json.dumps(receipt, ensure_ascii=False)
        self.assertEqual(receipt["status"], "local_config_passed_only")
        self.assertEqual(receipt["firebase_project_id"], self.kw["project"])
        self.assertEqual(receipt["android_package"], "br.com.atriocatolico.chatqa")
        self.assertEqual(receipt["fcm_sender_id"], "123456789")
        self.assertIn("fcm_delivery_on_physical_devices", receipt["not_verified"])
        self.assertIn("cloudflare_d1_binding", receipt["not_verified"])
        self.assertNotIn(self.config["client"][0]["api_key"][0]["current_key"],
                         serialized)
        self.assertNotIn("api_key", serialized)
        self.assertNotIn("private_key", serialized)
        self.assertNotIn("access_token", serialized)
        self.assertNotIn("FIREBASE_SERVICE_ACCOUNT_JSON", serialized)
        self.assertNotIn(config, serialized)

    def test_receipt_is_rejected_if_sha_changes(self):
        with self.assertRaises(QaBuildGateError):
            sanitized_receipt(self.path, **{**self.kw, "sha256": "0" * 64})


if __name__ == "__main__":
    unittest.main()
