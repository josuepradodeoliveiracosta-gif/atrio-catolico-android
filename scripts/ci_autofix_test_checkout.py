"""Historical QA test checkout, safe before and after the reviewed fix lands.

Tests always exercise the original fixed recipe in an isolated checkout while
also checking the actual repository state. No tests or production files are
changed and there are no network, shell, or write-token operations.
"""
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.ci_autofix_qa_review import (
    EDITS, QA_TARGET, QA_TARGET_SHA256, QA_PATCHED_SHA256,
    apply_reviewed_patch, qa_patch_state,
)
from scripts.ci_autofix_sandbox import sha256

REAL_ROOT = Path(__file__).resolve().parents[1]
_OWNED_CHECKOUT = None


def recover_original(corrected):
    """Reverse ONLY the seven known fixed hunks, then prove both hashes."""
    if not isinstance(corrected, str) or sha256(corrected) != QA_PATCHED_SHA256:
        raise ValueError("QA patched source does not match approved hash")
    recovered = corrected
    for old, new in reversed(EDITS):
        if recovered.count(new) != 1:
            raise ValueError("approved QA patch cannot be unambiguously reversed")
        recovered = recovered.replace(new, old, 1)
    if (sha256(recovered) != QA_TARGET_SHA256
            or apply_reviewed_patch(recovered) != corrected):
        raise ValueError("historical QA fixture failed round-trip verification")
    return recovered


def choose_test_root():
    """Preserve historical regression coverage after PR #261 is integrated."""
    global _OWNED_CHECKOUT
    state = qa_patch_state(REAL_ROOT)
    if state == "needs_patch":
        return REAL_ROOT
    if state != "already_applied":
        raise ValueError("unreviewed QA state")
    corrected = (REAL_ROOT / QA_TARGET).read_text(encoding="utf-8")
    recovered = recover_original(corrected)
    _OWNED_CHECKOUT = TemporaryDirectory(prefix="atrio-historical-qa-tests-")
    checkout = Path(_OWNED_CHECKOUT.name)
    qa_target = checkout / QA_TARGET
    qa_target.parent.mkdir(parents=True, exist_ok=True)
    qa_target.write_text(recovered, encoding="utf-8")
    if sha256(qa_target.read_text(encoding="utf-8")) != QA_TARGET_SHA256:
        raise ValueError("temporary historical QA source changed")
    for relative in (
            ".github/workflows/ci-quality-report.yml",
            ".github/workflows/autofix-qa-approved-draft.yml"):
        source = REAL_ROOT / relative
        destination = checkout / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    return checkout


ROOT = choose_test_root()
