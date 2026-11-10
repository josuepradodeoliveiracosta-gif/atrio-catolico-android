"""Testes diferenciais do npm audit sem rede."""
import unittest
from scripts.npm_audit_diff import compare, signatures


def sample(vulnerabilities):
    return {"auditReportVersion": 2, "metadata": {}, "vulnerabilities": vulnerabilities}


def high(source, severity="high"):
    return {"severity": severity, "via": [
        {"source": source, "severity": severity, "name": "example"}
    ]}


class NpmAuditDiffTests(unittest.TestCase):
    def test_existing_risk_alone_does_not_create_new_failure(self):
        old = sample({"oldpkg": high(200)})
        result, _ = compare(old, old)
        self.assertTrue(result["no_new_severe_vulnerabilities"])
        self.assertEqual(result["current_high_or_critical_signatures"], 1)

    def test_new_high_and_critical_are_blocking(self):
        old = sample({"oldpkg": high(200)})
        new = sample({"oldpkg": high(200), "pkg": high(300),
                      "critical": high(400, "critical")})
        result, report = compare(old, new)
        self.assertFalse(result["no_new_severe_vulnerabilities"])
        self.assertEqual(len(result["new_high_or_critical"]), 2)
        self.assertIn("Ação necessária", report)

    def test_moderate_and_low_are_not_misclassified(self):
        data = sample({"m": high(100, "moderate"), "l": high(101, "low")})
        self.assertEqual(signatures(data), set())

    def test_indirect_meta_vulnerability_is_detected(self):
        data = sample({"parent": {"severity": "high", "via": ["indirect-package"]}})
        self.assertIn(("parent", "indirect:indirect-package"), signatures(data))

    def test_missing_json_and_registry_errors_fail_closed(self):
        for data in ({}, {"error": {"summary": "offline"}},
                     {"auditReportVersion": 2},
                     {"auditReportVersion": 2, "vulnerabilities": []}):
            with self.assertRaises(ValueError):
                signatures(data)

    def test_same_advisory_fixed_in_head(self):
        old = sample({"pkg": high(400)})
        new = sample({})
        result, _ = compare(old, new)
        self.assertTrue(result["no_new_severe_vulnerabilities"])
        self.assertEqual(result["current_high_or_critical_signatures"], 0)


if __name__ == "__main__":
    unittest.main()
