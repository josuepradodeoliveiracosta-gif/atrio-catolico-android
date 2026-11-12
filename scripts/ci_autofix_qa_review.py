#!/usr/bin/env python3
"""Manually invoked QA patch preview for a real, hash-reviewed CI module.

This is an extension of the existing diagnosis/sandbox pipeline, NOT a second
automation agent. A verified source is read from the checkout, then patched
and rolled back only inside a disposable directory. There is no repository
write, token, network request, subprocess, merge, PR creation or deployment.
"""
import argparse
import ast
import difflib
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.ci_autofix_sandbox import read_pinned_qa_source, sha256

QA_TARGET = "scripts/ci_quality_report.py"
QA_ALLOWLIST = frozenset((QA_TARGET,))
QA_TARGET_SHA256 = "784f29513b0b41cdc24eee34326f5ece05339e30786d2dfa13ef0e448c31fdda"
MAX_SOURCE_BYTES = 12_000
MAX_DIFF_BYTES = 3_000
PATCH_ID = "ci_push_pr_only_check_scope_metadata_v1"

# Only approved, static source fragments: never accept a proposed patch, code,
# file path or command from a failed job or other untrusted report.
EDITS = (
    (
        """)


def validate_sha(sha):
""",
        """)
    
# These jobs are triggered by Pull Requests and do not run on main pushes.
# Never count an absent PR-only check as 'success' for a push.
PR_ONLY_REQUIRED_ON_PUSH = frozenset((
    "Regras de seguranca Firestore",
    "Compilar Android de testes",
    "Bloquear exclusoes em massa (Atrio)",
))


def validate_sha(sha):
""".replace(")\n    \n#", ")\n\n#"),
    ),
    (
        "def report(sha, checks):\n    validate_sha(sha)\n",
        "def report(sha, checks, source_event=\"unknown\"):\n"
        "    validate_sha(sha)\n"
        "    if source_event not in (\"unknown\", \"push\", \"pull_request\"):\n"
        "        raise ValueError(\"evento de CI invalido\")\n",
    ),
    (
        '    complete = all(value == "success" for value in required.values())\n',
        '    not_expected_on_push = sorted(\n'
        '        name for name in PR_ONLY_REQUIRED_ON_PUSH\n'
        '        if source_event == "push" and required[name] == "missing"\n'
        '    )\n'
        '    complete = all(value == "success" for value in required.values())\n',
    ),
    (
        '        "purpose": "audit_only_never_merge_approval",\n',
        '        "purpose": "audit_only_never_merge_approval",\n'
        '        "source_event": source_event,\n'
        '        "missing_pr_only_checks_on_push": not_expected_on_push,\n',
    ),
    (
        '    markdown.extend((\n        "", "### Duracoes observadas dos checks GitHub Actions", "",\n',
        '    if not_expected_on_push:\n'
        '        markdown.append(\n'
        '            "Escopo do evento: os checks PR-only ausentes no push nao sao esperados. "\n'
        '            "Continuam ausentes no relatorio; nao foram aprovados nem ignorados."\n'
        '        )\n'
        '    markdown.extend((\n        "", "### Duracoes observadas dos checks GitHub Actions", "",\n',
    ),
    (
        '    parser.add_argument("--sha", required=True)\n',
        '    parser.add_argument("--sha", required=True)\n'
        '    parser.add_argument("--source-event", default="unknown",\n'
        '                        choices=("unknown", "push", "pull_request"))\n',
    ),
    (
        '        args.sha, get_checks(args.sha, os.environ.get("GITHUB_TOKEN", ""))\n',
        '        args.sha, get_checks(args.sha, os.environ.get("GITHUB_TOKEN", "")),\n'
        '        source_event=args.source_event\n',
    ),
)


def apply_reviewed_patch(source):
    """Reject drift and apply a fixed event-scope metadata patch, no side effects."""
    if not isinstance(source, str) or sha256(source) != QA_TARGET_SHA256:
        raise ValueError("fonte de QA nao corresponde ao hash aprovado")
    patched = source
    for old, new in EDITS:
        if patched.count(old) != 1:
            raise ValueError("contexto do patch ambiguo ou alterado")
        patched = patched.replace(old, new, 1)
    ast.parse(patched, filename=QA_TARGET)
    compile(patched, QA_TARGET, "exec")
    return patched


def preview_real_qa_patch(checkout_root, relative_path=QA_TARGET):
    """Make + verify + roll back the reviewed patch exclusively in a sandbox."""
    source = read_pinned_qa_source(
        checkout_root, relative_path, QA_ALLOWLIST,
        QA_TARGET_SHA256, MAX_SOURCE_BYTES)
    changed = apply_reviewed_patch(source)
    patch = "".join(difflib.unified_diff(
        source.splitlines(keepends=True),
        changed.splitlines(keepends=True),
        fromfile="a/" + QA_TARGET, tofile="b/" + QA_TARGET, n=2,
    ))
    if (not patch or len(patch.encode("utf-8")) > MAX_DIFF_BYTES
            or patch.count("@@") > 18):
        raise ValueError("diff QA fora da politica permitida")
    with TemporaryDirectory(prefix="atrio-reviewed-qa-") as directory:
        root = Path(directory).resolve(strict=True)
        target = root / QA_TARGET
        target.parent.mkdir(parents=True)
        target.write_text(source, encoding="utf-8")
        if target.is_symlink() or target.resolve(strict=True).relative_to(root) != Path(QA_TARGET):
            raise ValueError("destino de sandbox invalido")
        if sha256(target.read_text(encoding="utf-8")) != QA_TARGET_SHA256:
            raise ValueError("origem QA alterada")
        target.write_text(changed, encoding="utf-8")
        if target.read_text(encoding="utf-8") != changed:
            raise ValueError("patch QA nao persistiu na sandbox")
        compile(target.read_text(encoding="utf-8"), QA_TARGET, "exec")
        # Explicitly prove restoration before disposable directory deletion.
        target.write_text(source, encoding="utf-8")
        if sha256(target.read_text(encoding="utf-8")) != QA_TARGET_SHA256:
            raise ValueError("rollback QA falhou")
    return {
        "mode": "manual_review_only_sandbox_preview",
        "patch_id": PATCH_ID,
        "target": QA_TARGET,
        "source_sha256": QA_TARGET_SHA256,
        "patched_sha256": sha256(changed),
        "patch": patch,
        "syntax_verified": True,
        "sandbox_rollback_verified": True,
        "checkout_files_changed": 0,
        "automatic_pull_requests_created": 0,
        "automatic_merges_or_deploys": 0,
        "production_access": False,
        "root_cause_established": False,
        "human_approval_required_for_repository_write": True,
        "regression_validation": "requires_ci_tests",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkout-root", required=True)
    args = parser.parse_args()
    # No output path argument: print bounded, static-source patch to stdout.
    print(json.dumps(preview_real_qa_patch(args.checkout_root),
                     ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
