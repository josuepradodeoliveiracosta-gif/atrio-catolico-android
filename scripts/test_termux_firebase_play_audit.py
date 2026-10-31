"""Testes offline do preflight Termux; jamais invocam firebase de verdade."""
import copy
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import termux_firebase_play_audit as audit


def sample():
    local = {"android_app_id": "1:123456:android:sample", "indexes": {
        "indexes": [{"collectionGroup": "posts", "queryScope": "COLLECTION",
                     "fields": [{"fieldPath": "uid", "order": "ASCENDING"},
                                {"fieldPath": "createdAt", "order": "DESCENDING"}]}],
        "fieldOverrides": [{"collectionGroup": "replies", "fieldPath": "createdAt",
                            "indexes": [{"order": "ASCENDING", "queryScope": "COLLECTION"},
                                        {"order": "DESCENDING", "queryScope": "COLLECTION"},
                                        {"order": "DESCENDING", "queryScope": "COLLECTION_GROUP"}]}]
    }}
    remote = {
        "projects": [{"projectId": "atrio-catolico"}],
        "android": [{"appId": local["android_app_id"]}],
        "web": [{"appId": "1:123456:web:abc"}],
        "databases": [{"name": "projects/atrio-catolico/databases/(default)"}],
        "indexes": {"indexes": [
            {**local["indexes"]["indexes"][0], "state": "READY",
             "fields": local["indexes"]["indexes"][0]["fields"] +
                [{"fieldPath": "__name__", "order": "DESCENDING"}]}
        ], "fieldOverrides": json.loads(json.dumps(local["indexes"]["fieldOverrides"]))},
    }
    return local, remote


class AuditTests(unittest.TestCase):
    def test_fixture_valid_without_claiming_release_approved(self):
        local, remote = sample()
        self.assertEqual(audit.evaluate(local, remote), [])

    def test_reject_missing_android_web_and_default_database(self):
        local, remote = sample()
        remote["android"] = []
        remote["web"] = []
        remote["databases"] = []
        self.assertEqual(set(audit.evaluate(local, remote)), {
            "firebase_app_android_nao_corresponde",
            "firebase_app_web_para_portal_nao_confirmado",
            "banco_firestore_default_nao_confirmado",
        })

    def test_reject_missing_not_ready_indexes_and_override(self):
        local, remote = sample()
        remote["indexes"]["indexes"][0]["state"] = "CREATING"
        remote["indexes"]["fieldOverrides"] = []
        self.assertEqual(set(audit.evaluate(local, remote)), {
            "indice_composto_ainda_nao_pronto", "override_indice_ausente",
        })
        remote["indexes"]["indexes"] = []
        self.assertIn("indice_composto_ausente", audit.evaluate(local, remote))
        local, remote = sample()
        # Mutar apenas a resposta remota, nunca a referencia esperada.
        remote["indexes"]["fieldOverrides"] = copy.deepcopy(remote["indexes"]["fieldOverrides"])
        remote["indexes"]["fieldOverrides"][0]["indexes"][0]["queryScope"] = "COLLECTION_GROUP"
        self.assertIn("override_indice_ausente", audit.evaluate(local, remote))

    def test_reject_unknown_response_or_cli_error_without_printing_content(self):
        with self.assertRaises(audit.AuditError):
            audit.parse_json("{not-json")
        with self.assertRaises(audit.AuditError):
            audit.parse_json(json.dumps({"status": "error", "message": "private-token"}))
        local, remote = sample()
        remote["web"] = {"unexpected": []}
        with self.assertRaises(audit.AuditError):
            audit.evaluate(local, remote)

    def test_queries_are_read_only_and_explicitly_project_scoped(self):
        seen = []
        local, remote = sample()
        for key in audit.COMMANDS:
            def run(argv, **_):
                seen.append(argv)
                return json.dumps({"status": "success", "result": remote[key]})
            self.assertEqual(audit.firebase_read(key, execute=run), remote[key])
        self.assertEqual(len(seen), 5)
        for argv in seen:
            self.assertEqual(argv[0], "firebase")
            self.assertEqual(argv[-1], "--json")
            self.assertFalse(any("deploy" in x or "delete" in x or
                                 "export" in x or "set" == x for x in argv))
            if argv[1] != "projects:list":
                self.assertEqual(argv[-3:], ["--project", audit.PROJECT, "--json"])

    def test_disallow_unlisted_queries_and_wrong_branch(self):
        with self.assertRaises(audit.AuditError):
            audit.firebase_read("firestore:delete", execute=lambda *_: "")
        with self.assertRaisesRegex(audit.AuditError, "branch_incorreta"):
            audit.local_preflight(execute=lambda *_a, **_k: "main")

    def test_main_does_not_attempt_firebase_when_local_guard_denies(self):
        with patch.object(audit.shutil, "which", return_value="/fake/path"), \
             patch.object(audit, "local_preflight", side_effect=audit.AuditError("branch_incorreta")), \
             patch.object(audit, "firebase_read") as reader:
            self.assertEqual(audit.main(), 2)
            reader.assert_not_called()


if __name__ == "__main__":
    unittest.main()
