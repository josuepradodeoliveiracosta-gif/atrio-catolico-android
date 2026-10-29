"""Generate a pinned Unicode 17 catalog and an exact RE2 allowlist; no production access.
Usage: python3 tools/emoji/generate.py /path/to/downloaded-inputs
Inputs: Unicode 17 emoji-test.txt, CLDR release-48 pt.xml/pt-derived.xml, LICENSE.txt.
"""
import hashlib, json, re, sys
from pathlib import Path
from xml.etree import ElementTree as ET
root = Path(__file__).resolve().parents[2]
source = Path(sys.argv[1])
normal = lambda x: x.replace('\ufe0f', '')
annotations = {}
for filename in ['pt.xml', 'pt-derived.xml']:
    for node in ET.parse(source / filename).iter('annotation'):
        key = normal(node.attrib['cp'])
        entry = annotations.setdefault(key, {})
        entry['label' if node.attrib.get('type') == 'tts' else 'words'] = node.text or ''
groups = ['Smileys & Emotion', 'People & Body', 'Animals & Nature', 'Food & Drink', 'Activities', 'Travel & Places', 'Objects', 'Symbols', 'Flags']
rows = []
for line in (source / 'emoji-test.txt').read_text().splitlines():
    if line.startswith('# group: '):
        group = line.removeprefix('# group: ')
    match = re.match(r'^([0-9A-F ]+)\s*; fully-qualified\s*# (\S+) E[\d.]+ (.+)$', line)
    if not match or group not in groups:
        continue
    codes, glyph, english = match.groups()
    assert glyph == ''.join(chr(int(c, 16)) for c in codes.split())
    names = annotations.get(normal(glyph), {})
    label = names.get('label', english)
    # English remains searchable alongside official Portuguese CLDR annotations.
    words = names.get('words', '') + ' ' + english
    base = ''.join(c for c in normal(glyph) if not 0x1f3fb <= ord(c) <= 0x1f3ff)
    rows.append((glyph, str(groups.index(group)), label, words, base))
assert len(rows) > 3900 and len({r[0] for r in rows}) == len(rows)
assets = root / 'app/src/main/assets'
assets.mkdir(parents=True, exist_ok=True)
(assets / 'reaction_emojis.tsv').write_text('\n'.join('\t'.join(r) for r in rows) + '\n')
(assets / 'UNICODE-LICENSE.txt').write_bytes((source / 'LICENSE.txt').read_bytes())
# Prefix trie avoids repeated family/tone sequences in the Firestore regex.
trie = {}
for glyph, *_ in rows:
    node = trie
    for char in glyph:
        node = node.setdefault(char, {})
    node[''] = {}
def escape(c):
    return '\\' + c if c in r'.^$*+?{}[]\|()' else c
def emit(node):
    options = [escape(c) + emit(child) for c, child in node.items() if c]
    if not options:
        return ''
    text = options[0] if len(options) == 1 else '(?:' + '|'.join(options) + ')'
    return '(?:' + text + ')?' if '' in node else text
pattern = emit(trie)
compiled = re.compile(pattern)
assert all(compiled.fullmatch(r[0]) for r in rows)
assert all(not compiled.fullmatch(s) for s in ['hello', '👍👍', '🏽', '👨\u200d', '🇧'])
# Firestore caps each regex at 4096; split the exact allowlist into bounded chunks.
def pattern_for(glyphs):
    tree = {}
    for glyph in glyphs:
        node = tree
        for char in glyph:
            node = node.setdefault(char, {})
        node[''] = {}
    return emit(tree)
patterns, bucket = [], []
for glyph, *_ in rows:
    candidate = pattern_for(bucket + [glyph])
    if bucket and (len(candidate.encode()) > 3500 or candidate.count('(') > 80):
        patterns.append(pattern_for(bucket))
        bucket = []
    bucket.append(glyph)
if bucket:
    patterns.append(pattern_for(bucket))
assert all(len(p.encode()) <= 3500 and p.count('(') <= 80 for p in patterns)
checks = []
for piece in patterns:
    escaped = piece.replace('\\', '\\\\').replace("'", "\\'")
    checks.append("kind.matches('%s')" % escaped)
block = """    // BEGIN GENERATED REACTION EMOJI ALLOWLIST (Unicode 17.0, tools/emoji/generate.py)
    function validReactionKind(kind) {
      return kind is string && (kind in ['heart', 'prayer', 'light']
        || (kind.size() <= 32 && (
          %s)));
    }
    // END GENERATED REACTION EMOJI ALLOWLIST
""" % ('\n          || '.join(checks))
path = root / 'firestore.rules'
rules = path.read_text()
if '// BEGIN GENERATED REACTION EMOJI ALLOWLIST' in rules:
    rules = re.sub(r'    // BEGIN GENERATED REACTION EMOJI ALLOWLIST.*?    // END GENERATED REACTION EMOJI ALLOWLIST\n', lambda _: block, rules, flags=re.S)
else:
    rules = rules.replace('    function validText(', block + '\n    function validText(', 1)
    rules = rules.replace("request.resource.data.kind in ['heart', 'prayer', 'light']", 'validReactionKind(request.resource.data.kind)')
    # Updating an orphan reaction must not recreate activity on a deleted reply.
    needle = "        match /reactions/{uid} {"
    start = rules.index(needle)
    end = rules.index('\n        }', start)
    section = rules[start:end].replace('allow update: if me(uid)\n', 'allow update: if me(uid)\n            && exists(/databases/$(database)/documents/posts/$(postId)/replies/$(replyId))\n')
    rules = rules[:start] + section + rules[end:]
path.write_text(rules)
(root / 'tools/emoji/provenance.json').write_text(json.dumps({
    'unicodeVersion': '17.0', 'cldrTag': 'release-48', 'fullyQualifiedCount': len(rows),
    'sources': ['https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt',
        'https://raw.githubusercontent.com/unicode-org/cldr/release-48/common/annotations/pt.xml',
        'https://raw.githubusercontent.com/unicode-org/cldr/release-48/common/annotationsDerived/pt.xml',
        'https://www.unicode.org/license.txt'],
    'sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir() if p.is_file()}
}, indent=2) + '\n')
print(f'{len(rows)} emojis; regex {len(pattern.encode())} bytes; rules {len(rules.encode())} bytes')
