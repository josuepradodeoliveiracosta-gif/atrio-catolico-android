"""Structural checks of round 44 protected route; no real signing in CI."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ROUTE = ROOT / ".github/workflows/qa-geral-celular-44-https.yml"


class Round44RouteTest(unittest.TestCase):
    def test_dispatch_only_and_founder(self):
        data = ROUTE.read_text()
        for job in ("build", "sign"):
            block = data.split("  " + job + ":\n", 1)[1].split("\n  sign:", 1)[0]
            for gate in ("github.event_name == 'workflow_dispatch'",
                         "inputs.confirm_delivery",
                         "inputs.source_sha == '20ee96fab69ce1dbf9678a57c057cef6070c2e74'",
                         "github.ref == 'refs/heads/main'", "github.ref_protected",
                         "github.run_attempt == 1",
                         "github.actor == 'josuepradodeoliveiracosta-gif'"):
                self.assertIn(gate, block)
        self.assertIn("default: false", data)
        self.assertIn("CANDIDATE_TREE: 13d2718d22683ef2a3d54465dd3b7be6bfd0eb33", data)
        self.assertIn('10#$INSTALLED_CODE < 44', data)

    def test_separation_and_encrypted_artifacts(self):
        data = ROUTE.read_text()
        build, sign = data.split("  sign:\n", 1)
        self.assertNotIn("ATRIO_QA_CELULAR_KEYSTORE_BASE64", build)
        self.assertIn("scripts/qa_geral_celular_build44_https.sh candidate", build)
        self.assertIn('age -r "$QA_TRANSFER_RECIPIENT"', build)
        self.assertIn("qa44.apk.age", build)
        self.assertIn("qa44-transfer-cifrada", sign)
        verification = sign.split("      - name: Assinar somente", 1)[0]
        self.assertNotIn("ATRIO_QA_CELULAR_KEYSTORE_BASE64", verification)
        self.assertIn("sha256sum -c -", verification)
        self.assertIn("scripts.qa_geral_celular_round44 metadata", verification)
        self.assertIn("scripts.qa_geral_celular_round44 proof", sign)
        self.assertIn("63b26756491bb0103e44e561d63c5481c0d9a6e7374b322ff4e97e1cd5629e57", sign)
        self.assertIn("atrio-qa44.apk.age", sign)
        self.assertIn("retention-days: 1", sign)


if __name__ == "__main__":
    unittest.main()
