"""Structural checks of round 47 protected route; no real signing in CI."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ROUTE = ROOT / ".github/workflows/qa-geral-celular-47-https.yml"


class Round47RouteTest(unittest.TestCase):
    def test_dispatch_only_and_founder(self):
        data = ROUTE.read_text()
        for job in ("build", "sign"):
            block = data.split("  " + job + ":\n", 1)[1].split("\n  sign:", 1)[0]
            for gate in ("github.event_name == 'workflow_dispatch'",
                         "inputs.confirm_delivery",
                         "inputs.source_sha == 'cf7b24db322699d1b132dbfd1084021274456c47'",
                         "github.ref == 'refs/heads/main'", "github.ref_protected",
                         "github.run_attempt == 1",
                         "github.actor == 'josuepradodeoliveiracosta-gif'"):
                self.assertIn(gate, block)
        self.assertIn("default: false", data)
        self.assertIn("CANDIDATE_TREE: 574a6b3d09ccc82c1a5afcfc9f5cd9941fd8e2ff", data)
        self.assertIn('[[ "$INSTALLED_CODE" == "46" ]]', data)

    def test_separation_and_encrypted_artifacts(self):
        data = ROUTE.read_text()
        build, sign = data.split("  sign:\n", 1)
        self.assertNotIn("ATRIO_QA_CELULAR_KEYSTORE_BASE64", build)
        self.assertIn("scripts/qa_geral_celular_build47_https.sh candidate", build)
        self.assertIn('age -r "$QA_TRANSFER_RECIPIENT"', build)
        self.assertIn("qa47.apk.age", build)
        self.assertIn("qa47-transfer-cifrada", sign)
        verification = sign.split("      - name: Assinar somente", 1)[0]
        self.assertNotIn("ATRIO_QA_CELULAR_KEYSTORE_BASE64", verification)
        self.assertIn("sha256sum -c -", verification)
        self.assertIn("scripts.qa_geral_celular_round47 metadata", verification)
        self.assertIn("scripts.qa_geral_celular_round47 proof", sign)
        self.assertIn("63b26756491bb0103e44e561d63c5481c0d9a6e7374b322ff4e97e1cd5629e57", sign)
        self.assertIn("atrio-qa47.apk.age", sign)
        self.assertIn("retention-days: 1", sign)


if __name__ == "__main__":
    unittest.main()
