import importlib.util
import pathlib
import unittest
import os
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location('scanner', pathlib.Path(__file__).with_name('security_scan.py'))
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class ScannerTests(unittest.TestCase):
    def test_history_preserves_sensitive_alias_and_unusual_paths(self):
        previous = os.getcwd()
        with tempfile.TemporaryDirectory() as directory:
            try:
                os.chdir(directory)
                def run(*args):
                    subprocess.run(['git', *args], check=True, capture_output=True)
                run('init')
                run('config', 'user.name', 'Test')
                run('config', 'user.email', 'test@example.invalid')
                pathlib.Path('notes.txt').write_text('placeholder')
                run('add', '.')
                run('commit', '-m', 'initial')
                pathlib.Path('credentials.json').write_text('placeholder')
                pathlib.Path('line\nname.key').write_text('placeholder')
                run('add', '.')
                run('commit', '-m', 'aliases')
                paths = {path for _, path, _ in scanner.objects(True)}
                self.assertTrue({'notes.txt', 'credentials.json', 'line\nname.key'} <= paths)
            finally:
                os.chdir(previous)

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

