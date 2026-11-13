#!/usr/bin/env python3
"""Collect numeric Rules coverage deltas in two pinned, demo-only Firebase Emulators.

No raw logs, rule values, user data, or production requests are stored.
The sole HTTP coverage request happens in Node against localhost:8089.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

from scripts.ci_historic_firestore_repro import CASES, PROJECT, safe_environment
from scripts.ci_historic_firestore_differential import _run

COVERAGE_MARKER = 'QA_RULECOV_'
COVERAGE_MAX_LOG = 12 * 1024 * 1024
MAX_ROWS = 6000
MAX_TARGETS = 70

JS_PROBE = r'''// QA-only rules coverage: numeric counters only; never print document values.
function qaSanitizeCoverage(document) {
  const data = Object.create(null);
  const seen = new WeakSet();
  let visited = 0;
  function countValue(x) {
    if (x === true || x === 'true') return 'true';
    if (x === false || x === 'false') return 'false';
    if (x === null || x === 'null' || x === 'undefined') return 'null';
    if (typeof x === 'string' && /^(error|undefined|null)/i.test(x)) return 'null';
    return 'other';
  }
  function walk(value, depth) {
    if (depth > 35 || value === null || typeof value !== 'object') return;
    if (seen.has(value) || ++visited > 35000) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const pos = value.sourcePosition;
    if (pos && typeof pos === 'object' &&
        Number.isInteger(pos.line) && Number.isInteger(pos.column) &&
        pos.line > 0 && pos.line <= 25000 && pos.column > 0 && pos.column <= 3000) {
      const key = String(pos.line) + ':' + String(pos.column);
      const counts = data[key] || {t:0,f:0,n:0,o:0};
      const vals = Array.isArray(value.values) ? value.values : [];
      for (const item of vals) {
        const raw = typeof item === 'object' && item !== null ? item.count : 0;
        const count = Number.isSafeInteger(raw) && raw >= 0 && raw < 1000000 ? raw : 0;
        const label = countValue(item && item.value);
        counts[label === 'true' ? 't' : label === 'false' ? 'f' : label === 'null' ? 'n' : 'o'] += count;
      }
      data[key] = counts;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'sourcePosition' || key === 'values') continue;
      if (typeof entry === 'object' && entry !== null) walk(entry, depth+1);
    }
  }
  walk(document, 0);
  const keys = Object.keys(data).sort((a,b) => {
    const [l1,c1] = a.split(':').map(Number);
    const [l2,c2] = b.split(':').map(Number);
    return l1-l2 || c1-c2;
  });
  return {ok: keys.length > 0 && keys.length <= 6000,
          positions: keys.length, truncated: keys.length > 6000,
          counters: Object.fromEntries(keys.slice(0,6000).map(k => [k,data[k]]))};
}
async function qaCoverageSnapshot(phase) {
  let snapshot;
  try {
    const response = await fetch(
      'http://127.0.0.1:8089/emulator/v1/projects/demo-atrio-v11:ruleCoverage',
      {redirect:'error',signal:AbortSignal.timeout(6000),headers:{Accept:'application/json'}});
    if (!response.ok) throw Error('coverage_http_failure');
    const size = Number(response.headers.get('content-length') || '0');
    if (size > 16000000) throw Error('coverage_oversized');
    const text = await response.text();
    if (text.length > 16000000) throw Error('coverage_oversized');
    snapshot = qaSanitizeCoverage(JSON.parse(text));
  } catch (_) {
    snapshot = {ok:false,positions:0,truncated:false,counters:{}};
  }
  console.log('QA_RULECOV_' + phase + ':' + JSON.stringify(snapshot));
}
'''

NOTICE_BEGIN = "  await check('resposta direta com aviso ao autor e destinatario passa',async()=>{"
NOTICE_END = "    assert.equal(n.data()?.replyToId,'lucia_seed');\n  });"
CHAT_TARGET = " await assertSucceeds(newInvite());"


def instrument_for_coverage(source, scenario):
    if scenario not in CASES or not isinstance(source, str):
        raise ValueError('invalid scenario/source')
    if 'QA_RULECOV_' in source or source.count('try {\n') < 1:
        raise ValueError('unexpected or already instrumented fixture')
    source = source.replace('try {\n', JS_PROBE + '\ntry {\n', 1)
    if scenario == 'reply_notice':
        if source.count(NOTICE_BEGIN) != 1 or source.count(NOTICE_END) != 1:
            raise ValueError('notice target changed')
        source = source.replace(
            NOTICE_BEGIN,
            "  await qaCoverageSnapshot('before');\n  try {\n" + NOTICE_BEGIN, 1)
        source = source.replace(
            NOTICE_END,
            NOTICE_END + "\n  } finally {\n    await qaCoverageSnapshot('after');\n  }", 1)
    else:
        if source.count(CHAT_TARGET) != 1:
            raise ValueError('invite target changed')
        source = source.replace(
            CHAT_TARGET,
            "  await qaCoverageSnapshot('before');\n  try {\n" + CHAT_TARGET +
            "\n  } finally {\n    await qaCoverageSnapshot('after');\n  }", 1)
    return source


def _safe_snapshot(row):
    if not isinstance(row, dict) or row.get('ok') is not True or row.get('truncated') is True:
        return None
    data = row.get('counters')
    if not isinstance(data, dict) or not 0 < len(data) <= MAX_ROWS:
        return None
    result = {}
    for key, counts in data.items():
        if not isinstance(key, str) or ':' not in key:
            return None
        line, column = key.split(':', 1)
        if not (line.isdecimal() and column.isdecimal() and 0 < int(line) <= 25000
                and 0 < int(column) <= 3000):
            return None
        if not isinstance(counts, dict):
            return None
        numeric = {}
        for label in ('t', 'f', 'n', 'o'):
            value = counts.get(label)
            if type(value) is not int or not 0 <= value < 100000000:
                return None
            numeric[label] = value
        result[f'{int(line)}:{int(column)}'] = numeric
    return result


def interpret_coverage(log):
    """Emit only position/count deltas; never raw log or arbitrary JSON fields."""
    if not isinstance(log, str) or len(log) > COVERAGE_MAX_LOG:
        return {'status': 'unavailable_or_log_too_large', 'before_positions': 0,
                'after_positions': 0, 'evaluated_positions_delta': 0,
                'top_expression_deltas': []}
    markers = {}
    for line in log.splitlines():
        if line.startswith(COVERAGE_MARKER):
            phase, sep, raw = line[len(COVERAGE_MARKER):].partition(':')
            if phase not in ('before', 'after') or not sep or phase in markers or len(raw) > 2000000:
                return {'status': 'invalid_coverage_markers', 'before_positions': 0,
                        'after_positions': 0, 'evaluated_positions_delta': 0,
                        'top_expression_deltas': []}
            try:
                markers[phase] = _safe_snapshot(json.loads(raw))
            except (ValueError, TypeError):
                markers[phase] = None
    before, after = markers.get('before'), markers.get('after')
    if not before or not after:
        return {'status': 'unavailable', 'before_positions': len(before or {}),
                'after_positions': len(after or {}),
                'before_marker_seen': 'before' in markers,
                'after_marker_seen': 'after' in markers,
                'evaluated_positions_delta': 0,
                'top_expression_deltas': []}
    rows = []
    for key in after.keys() | before.keys():
        old = before.get(key, {k: 0 for k in ('t','f','n','o')})
        new = after.get(key, {k: 0 for k in ('t','f','n','o')})
        delta = {k: new[k] - old[k] for k in ('t','f','n','o')}
        if any(value < 0 for value in delta.values()):
            return {'status': 'non_monotonic_coverage', 'before_positions': len(before),
                    'after_positions': len(after), 'evaluated_positions_delta': 0,
                    'top_expression_deltas': []}
        if sum(delta.values()):
            line, col = key.split(':')
            rows.append({'line': int(line), 'column': int(col), 'true': delta['t'],
                         'false': delta['f'], 'null_or_error': delta['n'],
                         'other': delta['o']})
    rows.sort(key=lambda q: (-q['null_or_error'], -q['false'],
              -sum(q[k] for k in ('true','false','null_or_error','other')),
              q['line'], q['column']))
    return {'status': 'evaluations_observed' if rows else 'no_expression_delta',
            'before_positions': len(before), 'after_positions': len(after),
            'evaluated_positions_delta': len(rows),
            'top_expression_deltas': rows[:MAX_TARGETS],
            'results_truncated': len(rows) > MAX_TARGETS,
            'coverage_is_cumulative_and_not_a_causal_proof': True}


def execute(case, historical, output, env=None):
    if case not in CASES:
        raise ValueError('unsupported historical scenario')
    root, dest = Path(historical).resolve(), Path(output).resolve()
    work = root / 'tests' / 'security'
    if not work.is_dir() or dest.exists() or root == dest or root in dest.parents:
        raise ValueError('invalid forensic path')
    secure_env = safe_environment(dict(os.environ if env is None else env))
    git = subprocess.run(('git','rev-parse','HEAD'), cwd=root, capture_output=True,
                         text=True, timeout=15, check=False)
    if git.returncode or git.stdout.strip() != CASES[case]['sha']:
        raise ValueError('historical SHA mismatch')
    prepared, _ = _run(CASES[case]['prepare'], work, secure_env, 90)
    if prepared:
        raise ValueError('demo-only rules setup failed')
    original_path = work / ('reply-notice-migration-lab.test.mjs' if case == 'reply_notice'
                            else 'qa-general-firestore.test.mjs')
    probe_path = work / '.atrio_local_rule_coverage.mjs'
    if original_path.is_symlink() or probe_path.exists():
        raise ValueError('unsafe test path')
    instrumented = instrument_for_coverage(original_path.read_text(encoding='utf-8'), case)
    try:
        with probe_path.open('x', encoding='utf-8') as handle:
            handle.write(instrumented)
        command = ('./node_modules/.bin/firebase', 'emulators:exec', '--only',
                   'firestore', '--config', CASES[case]['config'], '--project', PROJECT,
                   'node ' + probe_path.name)
        exit_code, output_log = _run(command, work, secure_env, CASES[case]['timeout'])
        verdict = interpret_coverage(output_log)
        record = {
            'schema_version': 1, 'scenario': case, 'checkout_sha': CASES[case]['sha'],
            'mode': 'localhost_8089_firestore_emulator_only',
            'test_exit_code': exit_code, 'test_succeeded': exit_code == 0,
            'coverage': verdict,
            'log_sha256': hashlib.sha256(output_log.encode('utf-8')).hexdigest(),
            'source_rules_modified': False, 'real_data_accessed': False,
            'raw_logs_published': False, 'raw_coverage_published': False,
            'causal_root_proven': False, 'independent_human_adjudication': False,
            'automatic_repair_performed': False, 'measured_accuracy_pct': None,
            'measured_repair_pct': None, 'production_writes': 0,
        }
        with dest.open('x', encoding='utf-8') as h:
            json.dump(record, h, ensure_ascii=False, indent=2, sort_keys=True)
            h.write('\n')
        return record
    finally:
        probe_path.unlink(missing_ok=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--scenario', choices=sorted(CASES), required=True)
    p.add_argument('--historical', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()
    result = execute(args.scenario,args.historical,args.output)
    print('Forensic local Rules coverage:',result['scenario'],
          'test_exit=',result['test_exit_code'],
          'coverage_status=',result['coverage']['status'],
          'candidate_lines=',len(result['coverage']['top_expression_deltas']),
          'causal_root_proven=false')
    if result['test_exit_code'] == 124:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
