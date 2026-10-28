import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('scanner', pathlib.Path(__file__).with_name('security_scan.py'))
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class ScannerTests(unittest.TestCase):
    def test_private_material(self):
        value = b'-----BEGIN ' + b'PRIVATE KEY-----\n' + b'A' * 80
        self.assertIn('private-key-material', scanner.findings('config.txt', value))

    def test_parser_marker_is_not_a_key(self):
        self.assertEqual([], scanner.findings('parser.py', b"replace('-----BEGIN PRIVATE KEY-----', '')"))

    def test_tokens(self):
        for prefix in (b'ghp_', b'github_pat_'):
            self.assertIn('github-token', scanner.findings('notes.md', prefix + b'a' * 50))

    def test_sensitive_names(self):
        for name in ('x.jks', '.env.production', 'dir/.dev.vars', 'qa-bots.json', 'key.properties'):
            self.assertIn('sensitive-file-name', scanner.findings(name, b''))

    def test_template_and_firebase_client(self):
        self.assertEqual([], scanner.findings('.env.example', b'EXAMPLE=placeholder'))
        self.assertEqual([], scanner.findings('app/google-services.json', b'{"project_id":"demo"}'))

    def test_service_account(self):
        self.assertIn('service-account-json', scanner.findings('renamed.json', b'{"type":' + b'"service_account"}'))


if __name__ == '__main__':
    unittest.main()
