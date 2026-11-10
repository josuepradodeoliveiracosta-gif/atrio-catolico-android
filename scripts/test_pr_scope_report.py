"""Testes puros do relatorio de escopo; nao acessam GitHub ou producao."""
import unittest
from scripts.pr_scope_report import classify, report, validate_sha

BASE = "a" * 40
HEAD = "b" * 40


class ScopeReportTests(unittest.TestCase):
    def test_domains(self):
        cases = {
            "app/src/main/A.kt": "Android",
            "gradle/wrapper/a": "Android",
            "firestore.rules": "Firebase/Firestore",
            "firebase/demo.rules": "Firebase/Firestore",
            "tests/security/a.mjs": "Firebase/Firestore",
            "cloudflare/a.js": "Cloudflare",
            ".github/workflows/ci.yml": "CI/Seguranca",
            "scripts/check.py": "Ferramentas",
            "docs/README.md": "Documentacao",
            "README.md": "Documentacao",
            "config.json": "Outros",
        }
        for path, group in cases.items():
            self.assertEqual(classify(path), group)

    def test_validation_rejects_untrusted_args(self):
        for value in ["", "main", "../main", "b" * 39, "z" * 40,
                      "a" * 40 + "; echo leaked"]:
            with self.assertRaises(ValueError):
                validate_sha(value)

    def test_small_review_has_no_warning(self):
        text = report(BASE, HEAD, ["app/a.kt", "docs/a.md"])
        self.assertIn("Arquivos modificados: **2**", text)
        self.assertIn("| Android | 1 |", text)
        self.assertIn("| Documentacao | 1 |", text)
        self.assertNotIn("escopo amplo", text)

    def test_broad_review_is_informative_not_rejected(self):
        paths = [f"app/A{i}.kt" for i in range(31)]
        text = report(BASE, HEAD, paths)
        self.assertIn("**Atencao, escopo amplo:**", text)
        self.assertIn("nao bloqueia a PR", text)

    def test_high_risk_areas_require_explicit_review(self):
        text = report(BASE, HEAD, [
            ".github/workflows/c.yml", "firestore.rules", "cloudflare/a.js"
        ])
        self.assertIn("Areas sensiveis detectadas", text)
        self.assertIn("autorizacao separada", text)
        self.assertNotIn("escopo amplo", text)

    def test_empty_diff_is_reported(self):
        text = report(BASE, HEAD, [])
        self.assertIn("Nenhuma mudanca detectada", text)


if __name__ == "__main__":
    unittest.main()
