#!/usr/bin/env python3
import unittest
from security_audit import forbidden_path, inspect_text

class PublicRepoSecurityTests(unittest.TestCase):
    def test_public_client_config_allowed(self):
        self.assertFalse(forbidden_path("app/google-services.json"))

    def test_privileged_files_rejected(self):
        for filename in ["cloudflare/serviceAccountKey.json", "firebase-adminsdk-abc.json",
             "secrets/firebase-admin.json", ".env", ".env.production",
             ".dev.vars", "signing.jks", "release.p12", "key.properties", "sa-private.pem"]:
            with self.subTest(filename=filename):
                self.assertTrue(forbidden_path(filename))

    def test_templates_allowed(self):
        for filename in [".env.example", ".dev.vars.example", "docs/keys-example.md"]:
            self.assertFalse(forbidden_path(filename))

    def test_fake_tokens_detected(self):
        for fake in ["ghp_" + "A"*40, "sk_live_" + "X"*30,
                     "-----BEGIN " + "PRIVATE KEY-----"]:
            self.assertTrue(inspect_text(fake))

    def test_no_public_config_false_positive(self):
        self.assertEqual(inspect_text("process.env.CLOUDFLARE_API_TOKEN"), [])
        self.assertEqual(inspect_text("app/google-services.json"), [])

if __name__ == "__main__":
    unittest.main()
