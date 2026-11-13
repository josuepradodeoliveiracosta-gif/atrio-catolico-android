#!/usr/bin/env python3
"""Read-only pilot: prove a genuine, pinned documentation repair candidate.

This is NOT a writer, nor is it wired to the privileged App workflow.
Never infer edit operations from logs, a PR or a user-provided path.
"""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory

TARGET = 'docs/ci/autocorrecao-automatica-github-app-2026-11-12.md'
SOURCE_BLOB_SHA1 = '12f8eecb3c4cb203c60f8f2bfeaf0fd476873a95'
MAX_SOURCE_BYTES = 20_000
MAX_PATCH_BYTES = 1_200
PATCH_ID = 'qa_document_integration_history_v1'
OLD = (
    '5. Revise a PR #260 e seus checks. **A integração na `main` exige\n'
    '   autorização expressa separada.** Depois da integração, o workflow\n'
    '   recebe eventos CodeQL de `push` na `main` automaticamente.'
)
NEW = (
    '6. **Depois das integrações autorizadas das PRs #260 e #262**, confira\n'
    '   no GitHub Actions o diagnóstico automático da `main` e seu bloqueio\n'
    '   quando não houver receita elegível. Não reaplique o patch da PR #261.'
)


def _git_blob_sha(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode('ascii') + b'\0' + data).hexdigest()


def _source_path(checkout_root):
    root = Path(checkout_root).resolve(strict=True)
    target = root
    for component in TARGET.split('/'):
        target = target / component
        if target.is_symlink():
            raise ValueError('arquivo ou diretorio QA symlink nao permitido')
    if not target.is_file() or target.resolve(strict=True) != root / TARGET:
        raise ValueError('arquivo QA nao e regular nem pertence a checkout')
    return target


def _pinned_source(checkout_root):
    target = _source_path(checkout_root)
    data = target.read_bytes()
    if len(data) > MAX_SOURCE_BYTES or _git_blob_sha(data) != SOURCE_BLOB_SHA1:
        raise ValueError('documento QA mudou ou nao corresponde ao blob revisado')
    try:
        return data.decode('utf-8')
    except UnicodeDecodeError as error:
        raise ValueError('documento QA nao e UTF-8') from error


def patch_static_source(source):
    if type(source) is not str:
        raise ValueError('documento QA invalido')
    data = source.encode('utf-8')
    if _git_blob_sha(data) != SOURCE_BLOB_SHA1:
        raise ValueError('documento QA alterado: hash nao aprovado')
    if source.count(OLD) != 1 or NEW in source:
        raise ValueError('trecho QA inesperado ou duplicado')
    changed = source.replace(OLD, NEW, 1)
    if changed == source or changed.count(NEW) != 1:
        raise ValueError('patch QA incompleto')
    return changed


def preview_doc_candidate(checkout_root):
    """Prove a single-document diff and rollback in a disposable sandbox."""
    source = _pinned_source(checkout_root)
    modified = patch_static_source(source)
    diff = ''.join(difflib.unified_diff(
        source.splitlines(keepends=True),
        modified.splitlines(keepends=True),
        fromfile='a/' + TARGET, tofile='b/' + TARGET, n=2,
    ))
    if not diff or len(diff.encode('utf-8')) > MAX_PATCH_BYTES or diff.count('@@') != 2:
        raise ValueError('diff QA maior do que a politica aprovada')
    with TemporaryDirectory(prefix='atrio-qa-doc-preview-') as directory:
        root = Path(directory)
        destination = root / TARGET
        destination.parent.mkdir(parents=True)
        destination.write_text(source, encoding='utf-8')
        destination.write_text(modified, encoding='utf-8')
        if destination.read_text(encoding='utf-8') != modified:
            raise ValueError('sandbox nao confirmou alteracao')
        destination.write_text(source, encoding='utf-8')
        if destination.read_text(encoding='utf-8') != source:
            raise ValueError('sandbox nao restaurou arquivo')
    if _pinned_source(checkout_root) != source:
        raise ValueError('checkout mudou durante a revisao')
    return {
        'status': 'docs_candidate_review_only',
        'patch_id': PATCH_ID,
        'target': TARGET,
        'source_blob_sha1': SOURCE_BLOB_SHA1,
        'patched_sha256': hashlib.sha256(modified.encode('utf-8')).hexdigest(),
        'diff': diff,
        'sandbox_rollback_verified': True,
        'remote_writes': 0,
        'automatic_pull_requests_created': 0,
        'automatic_merges_or_deploys': 0,
        'production_access': False,
        'requires_explicit_approval_before_app_write': True,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description='Verificar candidato real sem escrita.')
    parser.add_argument('--checkout-root', default='.')
    args = parser.parse_args(argv)
    result = preview_doc_candidate(args.checkout_root)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
