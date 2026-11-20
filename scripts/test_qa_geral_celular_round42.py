import io
from contextlib import redirect_stdout
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts import qa_geral_celular_round42 as round42


class Round42Test(unittest.TestCase):
    def test_requires_the_exact_package_and_both_version_fields(self):
        apk = Path("apk42.apk")
        tools = Path("build-tools")
        correct = (round42.PACKAGE, "42", round42.VERSION_NAME)
        for values, valid in (
            (correct, True),
            (("br.com.atriocatolico", *correct[1:]), False),
            ((correct[0], "41", correct[2]), False),
            ((*correct[:2], "0.19.10-qa-geral-celular-rodada-41"), False),
        ):
            package, code, name = values
            line = f"package: name='{package}' versionCode='{code}' versionName='{name}'"
            with self.subTest(values=values), redirect_stdout(io.StringIO()), \
                    patch.object(round42, "command", return_value=line), \
                    patch.object(round42, "verify_functional_variant") as functional:
                if valid:
                    round42.verify_metadata(apk, tools)
                    functional.assert_called_once_with(
                        apk, tools, 42, round42.REGISTERED_APP_ID, expected_code=42)
                else:
                    with self.assertRaisesRegex(round42.PreflightError, "Pacote ou versão"):
                        round42.verify_metadata(apk, tools)
                    functional.assert_not_called()

    def test_rejects_another_firebase_project_or_app_id(self):
        line = (f"package: name='{round42.PACKAGE}' versionCode='42' "
                f"versionName='{round42.VERSION_NAME}'")
        for resources in (
            f"projeto-ficticio {round42.REGISTERED_APP_ID}",
            f"{round42.QA_PROJECT} app-ficticio",
        ):
            with self.subTest(resources=resources), \
                    patch.object(round42, "command", return_value=line), \
                    patch("scripts.qa_geral_celular_approve.command", return_value=resources):
                with self.assertRaisesRegex(round42.PreflightError, "identidade Firebase"):
                    round42.verify_metadata(Path("apk42.apk"), Path("build-tools"))
