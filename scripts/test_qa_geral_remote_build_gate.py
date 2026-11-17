import copy
import json
from pathlib import Path
import tempfile
import unittest

from qa_geral_remote_build_gate import (
    CELULAR_FICTICIO,
    CELULAR_PACKAGE,
    FUNCTIONAL_FIXTURE,
    FUNCTIONAL_FIXTURE_APP_ID,
    LEGACY_APP_ID,
    QA_PROJECT,
    validate,
)


class QaGeralRemoteBuildGateTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.config_path = Path(directory.name) / "google-services.json"

    def check(self, config, *, project=QA_PROJECT, app_id=FUNCTIONAL_FIXTURE_APP_ID,
              package=CELULAR_PACKAGE, functional=True):
        self.config_path.write_text(json.dumps(config), encoding="utf-8")
        validate(self.config_path, project, app_id, package, functional=functional)

    def test_accepts_the_exact_functional_ci_fixture(self):
        self.check(FUNCTIONAL_FIXTURE)

    def test_accepts_an_independently_selected_qa_app_id(self):
        other_app_id = "1:835727158563:android:1111111111111111111111"
        config = copy.deepcopy(FUNCTIONAL_FIXTURE)
        client, = config["client"]
        client["client_info"]["mobilesdk_app_id"] = other_app_id
        client["api_key"][0]["current_key"] = "android-qa-client-key-for-test"
        self.check(config, app_id=other_app_id)
        with self.assertRaises(ValueError):
            self.check(config)

    def test_rejects_old_app_id_even_with_new_package_and_matching_reference(self):
        config = copy.deepcopy(FUNCTIONAL_FIXTURE)
        config["client"][0]["client_info"]["mobilesdk_app_id"] = LEGACY_APP_ID
        with self.assertRaises(ValueError):
            self.check(config, app_id=LEGACY_APP_ID)

    def test_rejects_wrong_project_number_package_and_extra_client(self):
        for field, value in (
            ("project_id", "atrio-catolico"),
            ("project_number", "000000000000"),
            ("package_name", "br.com.atriocatolico.qageral"),
            ("extra_client", True),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                config = copy.deepcopy(FUNCTIONAL_FIXTURE)
                if field == "package_name":
                    config["client"][0]["client_info"]["android_client_info"][field] = value
                elif field == "extra_client":
                    config["client"].append(config["client"][0])
                else:
                    config["project_info"][field] = value
                self.check(config)

    def test_rejects_crossing_the_two_fixture_modes(self):
        fixture_app_id = CELULAR_FICTICIO["client"][0]["client_info"]["mobilesdk_app_id"]
        fixture_project = CELULAR_FICTICIO["project_info"]["project_id"]
        self.check(CELULAR_FICTICIO, project=fixture_project, app_id=fixture_app_id, functional=False)
        with self.assertRaises(ValueError):
            self.check(CELULAR_FICTICIO, project=fixture_project, app_id=fixture_app_id)
        with self.assertRaises(ValueError):
            self.check(FUNCTIONAL_FIXTURE, functional=False)

    def test_rejects_reusing_the_ci_key_for_a_different_app(self):
        other_app_id = "1:835727158563:android:1111111111111111111111"
        config = copy.deepcopy(FUNCTIONAL_FIXTURE)
        config["client"][0]["client_info"]["mobilesdk_app_id"] = other_app_id
        with self.assertRaises(ValueError):
            self.check(config, app_id=other_app_id)

    def test_rejects_a_modified_functional_ci_fixture(self):
        config = copy.deepcopy(FUNCTIONAL_FIXTURE)
        config["client"][0]["api_key"][0]["current_key"] = "unexpected-client-key"
        with self.assertRaises(ValueError):
            self.check(config)

    def test_legacy_package_still_accepts_its_own_app_id(self):
        legacy_package = "br.com.atriocatolico.qageral"
        config = copy.deepcopy(FUNCTIONAL_FIXTURE)
        info = config["client"][0]["client_info"]
        info["mobilesdk_app_id"] = LEGACY_APP_ID
        info["android_client_info"]["package_name"] = legacy_package
        self.check(config, app_id=LEGACY_APP_ID, package=legacy_package, functional=False)
        with self.assertRaises(ValueError):
            self.check(config, app_id=LEGACY_APP_ID, package=legacy_package)


if __name__ == "__main__":
    unittest.main()
