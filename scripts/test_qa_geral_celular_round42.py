import io
import subprocess
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts import qa_geral_celular_round42 as round42


class BuildTransferTest(unittest.TestCase):
    def run_transfer(self, snapshot, ps_status=0):
        script = Path(__file__).with_name("qa_geral_celular_build42.sh").resolve()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "unsigned.apk"
            destination = Path(directory) / "signer-input.apk"
            source.write_bytes(b"APK de teste")
            result = subprocess.run(
                [
                    "bash", "-euo", "pipefail", "-c", r"""
                    source "$1"
                    snapshot="$4"
                    ps_status="$5"
                    sudo() {
                        case "$1" in
                            ps) printf '%s\n' "$snapshot"; return "$ps_status" ;;
                            pkill) return 0 ;;
                            install) echo 'install chamado'; command "$@" ;;
                            *) command "$@" ;;
                        esac
                    }
                    sleep() { :; }
                    transfer_unsigned_apk 4242 "$2" "$3"
                    """,
                    "build-transfer-test", str(script), str(source), str(destination),
                    snapshot, str(ps_status),
                ],
                capture_output=True, text=True, check=False, timeout=15,
            )
            transferred = destination.read_bytes() if destination.exists() else None
        return result, transferred

    def assert_refuses_transfer(self, snapshot, message, ps_status=0):
        result, transferred = self.run_transfer(snapshot, ps_status)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(message, result.stderr)
        self.assertNotIn("install chamado", result.stdout)
        self.assertIsNone(transferred)

    def test_inspection_failure_refuses_transfer_even_with_partial_output(self):
        self.assert_refuses_transfer(
            "0 0 R\n4242 4242 Z", "Falha ao inspecionar os processos", ps_status=2,
        )

    def test_invalid_snapshot_refuses_transfer(self):
        self.assert_refuses_transfer("0 0 R\nlista truncada", "Falha ao inspecionar os processos")

    def test_persistent_active_process_refuses_transfer(self):
        for active in ("4242 0 Sl", "0 4242 Sl"):
            with self.subTest(active=active):
                self.assert_refuses_transfer(f"0 0 R\n{active}\n4242 4242 Z", "Ainda há processos")

    def test_zombie_only_allows_transfer(self):
        result, transferred = self.run_transfer("0 0 R\n4242 4242 Z")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("APK de entrada encaminhado", result.stdout)
        self.assertEqual(transferred, b"APK de teste")


class Round42Test(unittest.TestCase):
    def test_requires_the_exact_package_and_both_version_fields(self):
        apk = Path("apk42.apk")
        tools = Path("build-tools")
        for package, code, name, valid in (
            (round42.PACKAGE, "42", round42.VERSION_NAME, True),
            ("br.com.atriocatolico", "42", round42.VERSION_NAME, False),
            (round42.PACKAGE, "41", round42.VERSION_NAME, False),
            (round42.PACKAGE, "42", "0.19.10-qa-geral-celular-rodada-41", False),
        ):
            line = f"package: name='{package}' versionCode='{code}' versionName='{name}'"
            with self.subTest(package=package, code=code, name=name), redirect_stdout(io.StringIO()), \
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
