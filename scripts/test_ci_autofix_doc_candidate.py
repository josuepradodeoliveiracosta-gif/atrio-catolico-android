"""Offline tests for a genuine but nonwriting QA-document recipe candidate."""
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts import ci_autofix_doc_candidate as candidate


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix='atrio-doc-qa-tests-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / candidate.TARGET
        self.path.parent.mkdir(parents=True)
        self.original = ('# QA manual\n\n'
                         + candidate.OLD + '\n\n## Critérios\n'
                         + 'A auditoria não permite escrita.\n')
        self.path.write_text(self.original, encoding='utf-8')
        blob = candidate._git_blob_sha(self.original.encode('utf-8'))
        self.pinned = patch.object(candidate, 'SOURCE_BLOB_SHA1', blob)
        self.pinned.start()
        self.addCleanup(self.pinned.stop)

    def test_single_static_markdown_diff_and_no_checkout_mutation(self):
        before = self.path.read_bytes()
        result = candidate.preview_doc_candidate(self.root)
        self.assertEqual(result['status'], 'docs_candidate_review_only')
        self.assertEqual(result['remote_writes'], 0)
        self.assertEqual(result['automatic_pull_requests_created'], 0)
        self.assertEqual(result['automatic_merges_or_deploys'], 0)
        self.assertFalse(result['production_access'])
        self.assertTrue(result['sandbox_rollback_verified'])
        self.assertTrue(result['requires_explicit_approval_before_app_write'])
        self.assertEqual(result['target'], candidate.TARGET)
        self.assertIn('+6. **Depois das integrações autorizadas', result['diff'])
        self.assertNotIn('app/src', result['diff'])
        self.assertEqual(self.path.read_bytes(), before)

    def test_rejects_already_corrected_document(self):
        self.path.write_text(self.original.replace(candidate.OLD, candidate.NEW), encoding='utf-8')
        with self.assertRaises(ValueError):
            candidate.preview_doc_candidate(self.root)

    def test_rejects_unexpected_edit_without_writing(self):
        self.path.write_text(self.original + 'Drift não aprovado\n', encoding='utf-8')
        before = self.path.read_bytes()
        with self.assertRaises(ValueError):
            candidate.preview_doc_candidate(self.root)
        self.assertEqual(self.path.read_bytes(), before)

    def test_rejects_duplicate_or_missing_old_fragment(self):
        for source in (self.original.replace(candidate.OLD, ''),
                       self.original + candidate.OLD):
            with self.subTest(length=len(source)):
                self.path.write_text(source, encoding='utf-8')
                with patch.object(candidate, 'SOURCE_BLOB_SHA1',
                                  candidate._git_blob_sha(source.encode('utf-8'))):
                    with self.assertRaises(ValueError):
                        candidate.preview_doc_candidate(self.root)

    def test_rejects_symlink_document(self):
        sibling = self.root / 'untrusted.md'
        sibling.write_text(self.original, encoding='utf-8')
        self.path.unlink()
        self.path.symlink_to(sibling)
        with self.assertRaises(ValueError):
            candidate.preview_doc_candidate(self.root)

    def test_rejects_symlink_parent_directory(self):
        original_docs = self.root / 'docs'
        original_docs.rename(self.root / 'actual-docs')
        original_docs.symlink_to(self.root / 'actual-docs', target_is_directory=True)
        with self.assertRaises(ValueError):
            candidate.preview_doc_candidate(self.root)

    def test_missing_file_and_non_directory_checkout_fail(self):
        self.path.unlink()
        with self.assertRaises(ValueError):
            candidate.preview_doc_candidate(self.root)
        with self.assertRaises((ValueError, OSError)):
            candidate.preview_doc_candidate(self.root / 'missing-root')

    def test_diff_alters_only_fixed_three_line_statement(self):
        patched = candidate.patch_static_source(self.original)
        self.assertEqual(patched, self.original.replace(candidate.OLD, candidate.NEW))
        self.assertEqual(candidate._git_blob_sha(self.original.encode('utf-8')),
                         candidate.SOURCE_BLOB_SHA1)
        self.assertEqual(hashlib.sha256(patched.encode('utf-8')).hexdigest(),
                         hashlib.sha256(candidate.patch_static_source(self.original).encode('utf-8')).hexdigest())

    def test_no_extra_cli_execute_or_apply_switch(self):
        self.assertFalse(hasattr(candidate, 'execute_patch'))
        self.assertFalse(hasattr(candidate, 'create_pr'))
        self.assertFalse(hasattr(candidate, 'deploy'))
        self.assertFalse(hasattr(candidate, 'write_remote'))


class LiveDocumentPinTests(unittest.TestCase):
    def test_real_checkout_has_exact_unfixed_document(self):
        root = Path(__file__).resolve().parents[1]
        result = candidate.preview_doc_candidate(root)
        self.assertEqual(result['source_blob_sha1'], candidate.SOURCE_BLOB_SHA1)
        self.assertEqual(result['target'], candidate.TARGET)
        self.assertTrue(result['sandbox_rollback_verified'])


if __name__ == '__main__':
    unittest.main()
