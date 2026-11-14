"""Contratos offline da identidade Firebase Perfil QA; sem rede, contas nem APK."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from scripts.perfil_qa_build_gate import (
    EXPECTED_APP_ID, EXPECTED_PACKAGE, EXPECTED_PROJECT, EXPECTED_SENDER,
    QaConfigError, validate,
)


class PerfilQaConfigTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "google-services.json"
        self.data = {
            "project_info": {
                "project_id": EXPECTED_PROJECT,
                "project_number": EXPECTED_SENDER,
                "storage_bucket": EXPECTED_PROJECT + ".firebasestorage.app",
            },
            "client": [{
                "client_info": {
                    "mobilesdk_app_id": EXPECTED_APP_ID,
                    "android_client_info": {"package_name": EXPECTED_PACKAGE},
                },
                "api_key": [{"current_key": "test-placeholder-qa-only-no-network"}],
            }],
        }
        self.save()

    def save(self):
        self.path.write_text(json.dumps(self.data), encoding="utf-8")
        self.digest = hashlib.sha256(self.path.read_bytes()).hexdigest()

    def rejected(self, sha=None):
        with self.assertRaises(QaConfigError):
            validate(self.path, self.digest if sha is None else sha)

    def test_exact_profile_qa_metadata_succeeds_offline(self):
        result = validate(self.path, self.digest)
        self.assertEqual(result["firebase_project_id"], EXPECTED_PROJECT)
        self.assertEqual(result["android_package"], EXPECTED_PACKAGE)
        self.assertEqual(result["hash_verified"], "true")
        self.assertNotIn("test-placeholder-qa-only", str(result))

    def test_production_project_is_rejected(self):
        self.data["project_info"]["project_id"] = "atrio-catolico"
        self.save()
        self.rejected()

    def test_chat_qa_project_is_rejected(self):
        self.data["project_info"]["project_id"] = "atrio-catolico-qa-geral"
        self.save()
        self.rejected()

    def test_wrong_android_package_is_rejected(self):
        self.data["client"][0]["client_info"]["android_client_info"]["package_name"] = "br.com.atriocatolico"
        self.save()
        self.rejected()

    def test_chat_qa_package_is_rejected(self):
        self.data["client"][0]["client_info"]["android_client_info"]["package_name"] = "br.com.atriocatolico.chatqa"
        self.save()
        self.rejected()

    def test_wrong_firebase_app_id_is_rejected(self):
        self.data["client"][0]["client_info"]["mobilesdk_app_id"] = "1:492511505084:android:another"
        self.save()
        self.rejected()

    def test_wrong_sender_id_is_rejected(self):
        self.data["project_info"]["project_number"] = "1"
        self.save()
        self.rejected()

    def test_extra_client_is_rejected(self):
        self.data["client"].append(self.data["client"][0])
        self.save()
        self.rejected()

    def test_storage_bucket_from_production_is_rejected(self):
        self.data["project_info"]["storage_bucket"] = "atrio-catolico.appspot.com"
        self.save()
        self.rejected()

    def test_missing_or_changed_hash_is_rejected(self):
        self.rejected("")
        self.rejected("0" * 64)
        self.path.write_text(self.path.read_text() + " ", encoding="utf-8")
        self.rejected()

    def test_duplicate_json_key_is_rejected(self):
        self.path.write_text(
            '{"project_info":{"project_id":"atrio-catolico",'
            '"project_id":"atrio-catolico-qa-perfil"}}',
            encoding="utf-8",
        )
        self.digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.rejected()

    def test_missing_file_and_symlink_are_rejected(self):
        real = self.path.with_name("real.json")
        self.path.rename(real)
        self.rejected()
        self.path.symlink_to(real)
        self.rejected()

    def test_invalid_json_is_rejected(self):
        self.path.write_text("{", encoding="utf-8")
        self.digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.rejected()

    def test_missing_or_multiple_api_keys_are_rejected(self):
        self.data["client"][0]["api_key"] = []
        self.save()
        self.rejected()
        self.data["client"][0]["api_key"] = [
            {"current_key": "fake-qa-test-only-1"},
            {"current_key": "fake-qa-test-only-2"},
        ]
        self.save()
        self.rejected()


if __name__ == "__main__":
    unittest.main()
