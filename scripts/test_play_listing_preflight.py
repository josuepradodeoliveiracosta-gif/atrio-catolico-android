#!/usr/bin/env python3
"""Offline regressions for the Google Play listing preflight."""
from pathlib import Path
import tempfile
import unittest

from play_listing_preflight import audit_listing, gate_snapshot


GRADLE = '''
android {
 defaultConfig {
  applicationId = "br.com.atriocatolico"
  versionCode = 37
 }
}
'''
COPY = {
    "title.txt": "Átrio Católico\n",
    "short_description.txt": "Comunidade católica para dialogar sobre a fé.\n",
    "full_description.txt": ("O Átrio Católico oferece discussões e perfis para "
        "participantes da comunidade. O aplicativo está em fase de testes "
        "e recebe melhorias a partir dos relatos dos usuários.\n"),
    "changelogs/37.txt": "Candidata para testes fechados, ainda em avaliação.\n",
}


class ListingPreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        path = self.root / "app/build.gradle.kts"
        path.parent.mkdir(parents=True)
        path.write_text(GRADLE, encoding="utf-8")
        self.base = self.root / "fastlane/metadata/android/pt-BR"
        for key, value in COPY.items():
            self.write(key, value)

    def write(self, name, value):
        path = self.base / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")

    def test_good_listing_is_only_metadata_ready(self):
        self.assertEqual(audit_listing(self.root), [])
        self.assertEqual(gate_snapshot(self.root)["releaseAuthorized"], False)

    def test_reject_oversized_title_and_short_description(self):
        self.write("title.txt", "x" * 31 + "\n")
        self.write("short_description.txt", "y" * 81 + "\n")
        self.assertEqual(len(audit_listing(self.root)), 2)

    def test_reject_short_or_oversized_full_description(self):
        self.write("full_description.txt", "curta\n")
        self.assertTrue(audit_listing(self.root))
        self.write("full_description.txt", "a" * 4001 + "\n")
        self.assertTrue(audit_listing(self.root))

    def test_reject_promises_and_placeholders(self):
        self.write("full_description.txt",
                   "a" * 90 + " Todos os dados são excluídos automaticamente.\n")
        self.assertTrue(audit_listing(self.root))
        self.write("full_description.txt", "a" * 90 + " TODO\n")
        self.assertTrue(audit_listing(self.root))

    def test_reject_invisible_characters_crlf_and_byte_order_mark(self):
        self.write("title.txt", "Átrio\u200b Católico\n")
        self.assertTrue(audit_listing(self.root))
        (self.base / "title.txt").write_bytes(b"\xef\xbb\xbfTitle\n")
        self.assertTrue(audit_listing(self.root))
        (self.base / "title.txt").write_bytes(b"Title\r\n")
        self.assertTrue(audit_listing(self.root))

    def test_reject_missing_or_wrong_version_changelog(self):
        (self.base / "changelogs/37.txt").unlink()
        self.assertTrue(audit_listing(self.root))
        self.write("changelogs/37.txt", COPY["changelogs/37.txt"])
        (self.root / "app/build.gradle.kts").write_text(
            GRADLE.replace("versionCode = 37", "versionCode = 38"))
        self.assertTrue(audit_listing(self.root))

    def test_reject_duplicate_code_and_changed_package(self):
        file = self.root / "app/build.gradle.kts"
        file.write_text(GRADLE.replace("versionCode = 37",
                                      "versionCode = 37\n  versionCode = 37"))
        self.assertTrue(audit_listing(self.root))
        file.write_text(GRADLE.replace("br.com.atriocatolico", "com.example.other"))
        self.assertTrue(audit_listing(self.root))

    def test_missing_evidence_never_means_authorized(self):
        snap = gate_snapshot(self.root)
        self.assertEqual(snap["privacy"], "nao_verificado")
        self.assertEqual(snap["ugc"], "nao_verificado")
        self.assertIs(snap["releaseAuthorized"], False)

    def test_counts_require_exact_true_not_truthy(self):
        (self.root / "docs").mkdir()
        (self.root / "docs/google-play-privacidade-evidencias.json").write_text(
            '{"requirements":{"a":{"verified":true},"b":{"verified":"true"}}}')
        self.assertEqual(gate_snapshot(self.root)["privacy"], "1/2")
        self.assertIs(gate_snapshot(self.root)["releaseAuthorized"], False)


if __name__ == "__main__":
    unittest.main()
