"""Regression tests for independent OTA release gates, without any GitHub secrets."""
import os
import re
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = (ROOT / ".github/workflows/build-apk.yml").read_text(encoding="utf-8")
PUBLISH = (ROOT / ".github/workflows/ota-publish-release.yml").read_text(encoding="utf-8")
GATES = ("ATRIO_OTA_E2E_TESTED", "ATRIO_OTA_RELEASE_APPROVED")


class OtaReleaseGateTests(unittest.TestCase):
    def test_both_gates_default_to_false_in_sign_and_publish(self):
        for document in (BUILD, PUBLISH):
            for gate in GATES:
                with self.subTest(gate=gate, workflow="sign" if document == BUILD else "publish"):
                    self.assertIn(
                        gate + ": " + "${{ vars." + gate + " || 'false' }}", document
                    )

    def test_release_signature_requires_both_gates_before_gradle(self):
        release = BUILD.split(
            "- name: Compilar APK release com chave permanente (quando configurada)", 1
        )[1].split("- name: Disponibilizar APK com assinatura permanente", 1)[0]
        self.assertIn("github.event_name == 'workflow_dispatch'", release)
        self.assertIn("github.ref == 'refs/heads/main'", release)
        signing = release.index("gradle :app:assembleRelease")
        for gate in GATES:
            with self.subTest(gate=gate):
                condition = f'if [[ "$' + gate + '" != "true" ]]; then'
                self.assertIn(condition, release)
                self.assertLess(release.index(condition), signing)
                self.assertIn("exit 1", release[release.index(condition):signing])
        self.assertIn('ATRIO_EMAIL_VERIFICATION_RELEASE_APPROVED', release)
        self.assertIn('ATRIO_GUARDIAN_V2_RELEASE_APPROVED', release)

    def test_publication_checks_both_gates_twice(self):
        publish_only = PUBLISH.split(
            "if [[ \"$RELEASE_MODE\" == \"publish\" ]]; then", 1
        )[1].split("fi\n", 1)[0]
        for gate in GATES:
            self.assertIn(f'"$${gate}"' if False else f'"$' + gate + '"', publish_only)
        final_job = PUBLISH.split("  publish-release:", 1)[1]
        condition = final_job.split("\n    needs:", 1)[0]
        for gate in GATES:
            self.assertIn(f"vars.{gate} == 'true'", condition)
        self.assertIn("inputs.mode == 'publish'", condition)
        self.assertIn("inputs.confirmation == 'PUBLICAR ATRIO'", condition)
        self.assertIn("gh release create", final_job)
        self.assertIn("gh release edit", final_job)

    def test_dispatch_values_are_env_data_not_inline_shell_code(self):
        self.assertIn("RELEASE_MODE: $" + "{{ inputs.mode }}", PUBLISH)
        self.assertIn("RELEASE_CONFIRMATION: $" + "{{ inputs.confirmation }}", PUBLISH)
        script = self._parameter_validation_script()
        self.assertNotIn("$" + "{{ inputs.", script)
        self.assertIn('case "$RELEASE_MODE" in', script)
        self.assertIn('if [[ "$RELEASE_MODE" == "publish" ]]; then', script)
        self.assertIn('[[ "$RELEASE_CONFIRMATION" == "PUBLICAR ATRIO" ]]', script)

    @staticmethod
    def _parameter_validation_script():
        step = PUBLISH.split(
            "      - name: Conferir parâmetros obrigatórios\n", 1,
        )[1].split(
            "      - name: Fixar execução de assinatura e artefato de origem\n", 1,
        )[0]
        return textwrap.dedent(step.split("        run: |\n", 1)[1])

    def test_dispatch_shell_rejects_command_substitution_as_plain_data(self):
        # Apenas preflight Bash local, sem GitHub API, APK, segredo ou publicacao.
        script = self._parameter_validation_script()
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "should-not-exist"
            env = dict(os.environ)
            env.update({
                "BUILD_RUN_ID": "12345",
                "APK_SHA256": "a" * 64,
                "EXPECTED_CERT": "b" * 64,
                "ATRIO_OTA_E2E_TESTED": "true",
                "ATRIO_OTA_RELEASE_APPROVED": "true",
                "ATRIO_EMAIL_VERIFICATION_RELEASE_APPROVED": "true",
                "ATRIO_RELEASE_MODERATION_MODE": "human",
                "ATRIO_GUARDIAN_V2_RELEASE_APPROVED": "false",
                "ATRIO_GUARDIAN_V2_WORKER_URL": "",
                "RELEASE_MODE": "publish",
                "RELEASE_CONFIRMATION": "PUBLICAR ATRIO",
            })

            def validate():
                return subprocess.run(
                    ["bash", "-c", script],
                    cwd=temporary, env=env,
                    capture_output=True, text=True, timeout=10,
                    check=False,
                )

            self.assertEqual(validate().returncode, 0,
                             "a confirmação oficial deve continuar aceita")
            env["RELEASE_CONFIRMATION"] = (
                "PUBLICAR ATRIO$(touch " + str(marker) + ")"
            )
            self.assertNotEqual(validate().returncode, 0)
            self.assertFalse(marker.exists(), "entrada não deve executar comandos")
            env["RELEASE_MODE"] = "publish$(touch " + str(marker) + ")"
            self.assertNotEqual(validate().returncode, 0)
            self.assertFalse(marker.exists(), "modo não deve executar comandos")
            env["RELEASE_MODE"] = "validate"
            self.assertEqual(validate().returncode, 0,
                             "modo somente validar deve permanecer funcional")
            self.assertFalse(marker.exists())

    def test_no_automatic_sign_or_publish_when_main_changes(self):
        self.assertIn("if: github.event_name == 'workflow_dispatch'", BUILD)
        self.assertIn("workflow_dispatch:", PUBLISH)
        for forbidden in ("  schedule:", "  workflow_run:"):
            self.assertNotIn(forbidden, PUBLISH)
        self.assertNotIn("  push:", PUBLISH)

    def test_debug_still_allowed_but_does_not_masquerade_as_e2e(self):
        self.assertIn("gradle :app:assembleDebug", BUILD)
        ota_check = (
            ROOT / "app/src/main/java/br/com/atriocatolico/OtaReleaseClient.kt"
        ).read_text(encoding="utf-8")
        # O Debug convencional continua sem OTA. Somente o aplicativo
        # .otalab, compilado deliberadamente em QA, exercita o cliente real.
        self.assertIn(
            "if (BuildConfig.DEBUG && !OtaQaChannel.active) return OtaCheckStatus.TestBuild",
            ota_check,
        )
        qa_channel = (
            ROOT / "app/src/main/java/br/com/atriocatolico/OtaQaChannel.kt"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "BuildConfig.DEBUG && BuildConfig.OTA_QA_LOOPBACK", qa_channel
        )
        gradle = (ROOT / "app/build.gradle.kts").read_text(encoding="utf-8")
        self.assertIn(
            'System.getenv("ATRIO_OTA_QA_LOOPBACK") == "1"', gradle
        )
        self.assertIn(
            'if (atrioOtaQaLoopback) applicationIdSuffix = ".otalab"', gradle
        )
        self.assertIn(
            'buildConfigField("boolean", "OTA_QA_LOOPBACK", "false")', gradle
        )
        self.assertIn(
            "O laboratorio OTA isolado nunca pode compilar APK ou bundle Release.",
            gradle,
        )
        lab_qa = (
            ROOT / ".github/workflows/ota-upgrade-qa.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("adb", (ROOT / "scripts/ota_qa_upgrade.sh").read_text(encoding="utf-8"))
        self.assertIn("Dois APKs **debug**", lab_qa)
        self.assertTrue(
            (ROOT / "docs/qa-homologacao/OTA_RELEASE_GATE.md").exists()
        )


if __name__ == "__main__":
    unittest.main()
