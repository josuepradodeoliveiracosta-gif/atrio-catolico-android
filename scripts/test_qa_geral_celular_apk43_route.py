"""Regressões estruturais da rota HTTPS do APK 43, sem acessar segredos ou serviços."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/qa_geral_celular_build43_https.sh"
ROUTE = ROOT / ".github/workflows/qa-geral-celular-43-https.yml"


class IsolatedBuildRouteTest(unittest.TestCase):
    def test_bash_syntax(self):
        subprocess.run(["bash", "-n", str(SCRIPT)], check=True)

    def run_sourced_probe(self, status):
        snippet = (
            'source "$1"; '
            'sudo(){ if [[ "$1" == "ps" ]]; then printf "%s\\n" "$STATUS"; '
            'else return 1; fi; }; '
            'kill_build_processes(){ :; }; '
            'sleep(){ :; }; '
            'wait_for_build_exit 4242'
        )
        return subprocess.run(
            ["bash", "-c", snippet, "bash", str(SCRIPT)],
            env={"PATH": "/usr/bin:/bin", "STATUS": status},
            text=True, capture_output=True, timeout=10,
        )

    def test_wait_allows_stopped_or_unrelated_processes(self):
        self.assertEqual(self.run_sourced_probe("1000 1000 S").returncode, 0)
        self.assertEqual(self.run_sourced_probe("4242 4242 Z").returncode, 0)

    def test_wait_fails_closed_for_live_or_invalid_process_list(self):
        self.assertNotEqual(self.run_sourced_probe("4242 4242 S").returncode, 0)
        self.assertNotEqual(self.run_sourced_probe("invalid ps result").returncode, 0)

    def test_transfers_only_after_process_exit(self):
        data = SCRIPT.read_text()
        self.assertLess(data.index('wait_for_build_exit "$uid" || return 1'),
                        data.index('sudo install -m 600'))
        self.assertIn('sudo -u "$builder" -- env -i', data)
        self.assertIn('sudo -u "$builder" -- test ! -w "${GITHUB_WORKSPACE', data)
        self.assertIn('sudo -u "$builder" -- test ! -w "${RUNNER_TEMP', data)
        self.assertIn("test -f \"$gradle_root/lib/gradle-launcher-8.13.jar\"", data)
        self.assertIn('python3 scripts/qa_geral_remote_build_gate.py --registered "$config"', data)
        self.assertIn('ATRIO_QA_GERAL_CELULAR_RODADA43=1', data)
        self.assertIn('ATRIO_QA_CONVERSATION_NOTICE_ORIGIN="$2"', data)
        self.assertIn('test ! -L "$input"', data)

    def test_signer_checks_real_received_bytes_before_keystore(self):
        data = ROUTE.read_text()
        signing = data.split("  sign:", 1)[1]
        before_key = signing.split("base64 --decode", 1)[0]
        self.assertIn("sha256sum -c -", before_key)
        self.assertIn('metadata "$work/unsigned.apk"', before_key)
        self.assertIn("--notice-https", before_key)
        self.assertIn('apksigner" verify "$work/unsigned.apk"', before_key)
        self.assertIn("source candidate", before_key)
        self.assertIn("proof candidate", signing)
        self.assertIn('QA_EXPECTED_CERT_SHA256:', signing)
        self.assertIn('environment: qa-geral-celular-assinatura', signing)
        self.assertIn("github.ref_protected && github.run_attempt == 1", signing)
        self.assertIn("atrio-qa43-funcional-cifrado", signing)

    def test_route_builds_pinned_candidate_without_inheriting_signing_secrets(self):
        data = ROUTE.read_text()
        build = data.split("  build:", 1)[1].split("  sign:", 1)[0]
        self.assertIn("CANDIDATE_SHA: 587dc41efed0d171aaacd0bda48fb7bff1a9fb58", data)
        self.assertIn("CANDIDATE_TREE: 3263fd3640de1c6f8e128dcf384129fde03596cf", data)
        self.assertIn('build43_https.sh candidate', build)
        self.assertIn('sha256sum < "$RUNNER_TEMP/qa43.apk"', build)
        self.assertNotIn("ATRIO_QA_CELULAR_KEYSTORE", build)
        self.assertIn("age -r", build)
        self.assertIn("workflow_dispatch:", data)


if __name__ == "__main__":
    unittest.main()
