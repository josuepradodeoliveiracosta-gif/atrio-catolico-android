#!/usr/bin/env python3
"""Supplemental offline secret scan. Reports locations, NEVER matched values.

Not a substitute for GitHub secret scanning, provider validation or manual review.
--history scans all locally fetched refs; checkout must use fetch-depth: 0.
"""
import argparse
import pathlib
import re
import subprocess
import sys

PATTERNS = {
    'private-key-material': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----(?:\\n|\s)+[A-Za-z0-9+/=]{40,}'),
    'github-token': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b'),
    'aws-access-key': re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'google-oauth-token': re.compile(rb'\bya29\.[A-Za-z0-9_-]{40,}'),
    'slack-token': re.compile(rb'\bxox[baprs]-[A-Za-z0-9-]{20,}'),
    'jwt-literal': re.compile(rb'\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'),
    'service-account-json': re.compile(rb'"type"\s*:\s*"service_account"'),
}
SENSITIVE_PATH = re.compile(r'(?i)(?:\.(?:jks|keystore|p12|pfx|pem|key)$|(?:^|/)(?:\.env(?:\..+)?|\.dev\.vars(?:\..+)?|credentials\.json|qa-bots\.json|key\.properties|keystore\.properties)$|(?:service[-_]?account|firebase-adminsdk).*\.json$)')


def findings(path, data):
    result = []
    if SENSITIVE_PATH.search(path) and not path.endswith(('.example', '.example.json')):
        result.append('sensitive-file-name')
    result.extend(name for name, pattern in PATTERNS.items() if pattern.search(data))
    return result


def git(*args):
    return subprocess.check_output(['git', *args], stderr=subprocess.DEVNULL)


def objects(history):
    if history:
        # Inspect every historical path, including aliases of identical blobs.
        seen = set()
        for commit in git('rev-list', '--all').splitlines():
            for record in git('ls-tree', '-r', '-z', commit.decode()).split(b'\0'):
                if not record:
                    continue
                metadata, raw_path = record.split(b'\t', 1)
                _, kind, oid = metadata.split()
                key = (oid, raw_path)
                if kind != b'blob' or key in seen:
                    continue
                seen.add(key)
                yield oid.decode(), raw_path.decode(errors='surrogateescape'), git('cat-file', 'blob', oid.decode())
    else:
        for raw in git('ls-files', '-z').split(b'\0'):
            if not raw:
                continue
            path = raw.decode()
            p = pathlib.Path(path)
            if p.is_symlink():
                yield 'worktree', path, b''
            elif p.is_file():
                yield 'worktree', path, p.read_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--history', action='store_true')
    args = parser.parse_args()
    checked = issues = 0
    for oid, path, data in objects(args.history):
        checked += 1
        for kind in findings(path, data):
            issues += 1
            # repr prevents newlines/control characters being interpreted as annotations.
            print(f'{kind}: {path!r} (object {oid})')
    print(f'Checked {checked} objects; {issues} findings. Pattern scan only; no security certification.')
    return 1 if issues else 0


if __name__ == '__main__':
    sys.exit(main())

