"""Offline-only pinned QA-document fixture for tests after a one-shot draft.

The production writer keeps its strict original-blob guard. This helper
reconstructs that approved input in a temporary checkout for offline tests,
whether the real checkout has the original document or the one exact approved
patch. All other modifications fail closed.
"""
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.ci_autofix_doc_candidate import (
    NEW, OLD, SOURCE_BLOB_SHA1, TARGET, _git_blob_sha,
)


def original_document_for_test(repo_root):
    observed = (Path(repo_root) / TARGET).read_bytes()
    if _git_blob_sha(observed) == SOURCE_BLOB_SHA1:
        return observed

    text = observed.decode("utf-8")
    if text.count(NEW) != 1 or OLD in text:
        raise ValueError("documento QA nao corresponde ao patch historico aprovado")
    original = text.replace(NEW, OLD, 1).encode("utf-8")
    if (_git_blob_sha(original) != SOURCE_BLOB_SHA1
            or original.decode("utf-8").replace(OLD, NEW, 1).encode("utf-8")
            != observed):
        raise ValueError("alteracao documental QA fora da receita fixa")
    return original


@contextmanager
def pinned_doc_checkout(repo_root):
    """Build an isolated, original-hash checkout; never modify the repository."""
    source = original_document_for_test(repo_root)
    with TemporaryDirectory(prefix="atrio-qa-doc-fixture-") as folder:
        root = Path(folder)
        target = root / TARGET
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source)
        yield root
