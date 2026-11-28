"""Structural checks of round 54 protected route; no real signing in CI."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ROUTE = ROOT / ".github/workflows/qa-geral-celular-54-https.yml"


class Round54RouteTest(unittest.TestCase):
    def test_dispatch_only_and_founder(self):
        data = ROUTE.read_text()
        for job in ("build", "sign"):
            block = data.split("  " + job + ":\n", 1)[1].split("\n  sign:", 1)[0]
            for gate in ("github.event_name == 'workflow_dispatch'",
                         "inputs.confirm_delivery",
                         "inputs.source_sha == '5dd8eda3c95c63db697f03b012393b64c080e2e1'",
                         "github.ref == 'refs/heads/main'", "github.ref_protected",
                         "github.run_attempt == 1",
                         "github.actor == 'josuepradodeoliveiracosta-gif'"):
                self.assertIn(gate, block)
        self.assertIn("default: false", data)
        self.assertIn("CANDIDATE_TREE: 33dddb77bb3ce0fb7473155c6b9d677c12c8c4f8", data)
        self.assertIn('[[ "$INSTALLED_CODE" == "53" ]]', data)

    def test_separation_and_encrypted_artifacts(self):
        data = ROUTE.read_text()
        build, sign = data.split("  sign:\n", 1)
        self.assertNotIn("ATRIO_QA_CELULAR_KEYSTORE_BASE64", build)
        self.assertIn("scripts/qa_geral_celular_build54_https.sh candidate", build)
        self.assertIn('age -r "$QA_TRANSFER_RECIPIENT"', build)
        self.assertIn("qa54.apk.age", build)
        self.assertIn("qa54-transfer-cifrada", sign)
        verification = sign.split("      - name: Assinar somente", 1)[0]
        self.assertNotIn("ATRIO_QA_CELULAR_KEYSTORE_BASE64", verification)
        self.assertIn("sha256sum -c -", verification)
        self.assertIn("scripts.qa_geral_celular_round54 metadata", verification)
        self.assertIn("scripts.qa_geral_celular_round54 proof", sign)
        self.assertIn("63b26756491bb0103e44e561d63c5481c0d9a6e7374b322ff4e97e1cd5629e57", sign)
        self.assertIn("atrio-qa54.apk.age", sign)
        self.assertIn("retention-days: 1", sign)
        self.assertIn('for area in ("login", "cadastro", "boas-vindas", "participacao"):', build)


if __name__ == "__main__":
    unittest.main()
