"""Round 46 verifier must keep the exact version and audited manifest gate."""
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
from scripts import qa_geral_celular_round46 as verifier
from scripts.ota_apk_preflight import PreflightError


class Round46Test(TestCase):
    def test_metadata_requires_new_version_and_https_manifest(self):
        apk, tools = Path("candidate.apk"), Path("/sdk/build-tools/36.0.0")
        resources = verifier.QA_PROJECT + " " + verifier.REGISTERED_APP_ID
        with patch.object(verifier, "verify_package_version") as version, \
                patch.object(verifier, "verify_notice_manifest") as manifest, \
                patch.object(verifier, "command", side_effect=["fixture manifest", resources]):
            self.assertEqual(len(verifier.verify_metadata(apk, tools)), 64)
            version.assert_called_once_with(apk, tools, 46, "0.19.10-qa-geral-celular-rodada-46")
            manifest.assert_called_once_with("fixture manifest", https=True)

    def test_metadata_refuses_wrong_identity(self):
        with patch.object(verifier, "verify_package_version"), \
                patch.object(verifier, "verify_notice_manifest"), \
                patch.object(verifier, "command", side_effect=["fixture manifest", "other project"]):
            with self.assertRaises(PreflightError):
                verifier.verify_metadata(Path("candidate.apk"), Path("/sdk/build-tools/36.0.0"))
