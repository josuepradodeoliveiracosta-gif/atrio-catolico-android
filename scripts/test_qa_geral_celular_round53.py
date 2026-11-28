"""Round 53 verifier must keep the exact version and audited manifest gate."""
from pathlib import Path
from hashlib import sha256
from tempfile import TemporaryDirectory
from zipfile import ZipFile
from unittest import TestCase
from unittest.mock import patch
from scripts import qa_geral_celular_round53 as verifier
from scripts.ota_apk_preflight import PreflightError


class Round53Test(TestCase):
    def test_metadata_requires_new_version_and_https_manifest(self):
        apk, tools = Path("candidate.apk"), Path("/sdk/build-tools/36.0.0")
        resources = verifier.QA_PROJECT + " " + verifier.REGISTERED_APP_ID
        with patch.object(verifier, "verify_package_version") as version, \
                patch.object(verifier, "verify_notice_manifest") as manifest, \
                patch.object(verifier, "verify_assets") as assets, \
                patch.object(verifier, "command", side_effect=["fixture manifest", resources]):
            self.assertEqual(len(verifier.verify_metadata(apk, tools)), 64)
            version.assert_called_once_with(apk, tools, 53, "0.19.10-qa-geral-celular-rodada-53")
            manifest.assert_called_once_with("fixture manifest", https=True)
            assets.assert_called_once_with(apk)

    def test_metadata_refuses_wrong_identity(self):
        with patch.object(verifier, "verify_package_version"), \
                patch.object(verifier, "verify_notice_manifest"), \
                patch.object(verifier, "command", side_effect=["fixture manifest", "other project"]):
            with self.assertRaises(PreflightError):
                verifier.verify_metadata(Path("candidate.apk"), Path("/sdk/build-tools/36.0.0"))


    def test_approved_asset_inventory(self):
        self.assertEqual(len(verifier.EXPECTED_ASSETS), 24)
        for area in ("login", "cadastro", "boas-vindas", "participacao"):
            self.assertEqual(sum(name.startswith(f"assets/{area}-vitrais/") for name in verifier.EXPECTED_ASSETS), 6)

    def test_assets_refuse_missing_or_tampered(self):
        name = "assets/boas-vindas-vitrais/fixture.webp"
        content = b"fixture"
        with TemporaryDirectory() as directory, patch.object(verifier, "EXPECTED_ASSETS", {name: sha256(content).hexdigest()}):
            apk = Path(directory) / "test.apk"
            for value in (None, b"wrong", content):
                with ZipFile(apk, "w") as archive:
                    if value is not None:
                        archive.writestr(name, value)
                if value == content:
                    verifier.verify_assets(apk)
                else:
                    with self.assertRaises(PreflightError):
                        verifier.verify_assets(apk)
