"""Offline tests: preserve targeted assertions and emit only safe Rules deltas."""
import json
import unittest

from scripts.ci_historic_firestore_coverage import (
    NOTICE_BEGIN, NOTICE_END, CHAT_TARGET, JS_PROBE,
    instrument_for_coverage, interpret_coverage,
)


def log_snapshots(before, after):
    return ("QA_RULECOV_before:" + json.dumps(before) + "\n" +
            "Error: PERMISSION_DENIED SECRET=private-personal-text\n" +
            "QA_RULECOV_after:" + json.dumps(after) + "\n")


class CoverageSafeguards(unittest.TestCase):
    def test_notice_wraps_exact_positive_and_preserves_assertion(self):
        source = ("import {x} from 'x';\ntry {\n" +
                  NOTICE_BEGIN + "\n    await assertSucceeds(b.commit());\n" +
                  NOTICE_END + "\n} finally { await env.cleanup(); }\n")
        result = instrument_for_coverage(source, 'reply_notice')
        self.assertEqual(result.count(NOTICE_BEGIN), 1)
        self.assertEqual(result.count(NOTICE_END), 1)
        self.assertIn("qaCoverageSnapshot('before')", result)
        self.assertIn("qaCoverageSnapshot('after')", result)
        self.assertEqual(result.count('QA_RULECOV_'), JS_PROBE.count('QA_RULECOV_'))
        self.assertIn('await assertSucceeds(b.commit());', result)
        self.assertIn('127.0.0.1:8089', result)
        self.assertNotIn('firebase deploy', result)

    def test_chat_wraps_only_invite_not_permissions(self):
        self.assertEqual(CHAT_TARGET, " await assertSucceeds(newInvite());")
        source = "import {x} from 'x';\ntry {\n" + CHAT_TARGET + "\n}finally{}\n"
        result = instrument_for_coverage(source, 'chat_general')
        self.assertIn(CHAT_TARGET, result)
        self.assertEqual(result.count('qaCoverageSnapshot('), 3)
        self.assertIn("  try {\n" + CHAT_TARGET, result)
        self.assertIn('} finally {', result)

    def test_missing_or_duplicate_instrumentation_refused(self):
        for source, case in (("try {\n}", 'reply_notice'),
                             ("try {\n}", 'chat_general'),
                             ("QA_RULECOV_before:tampered\ntry {\n}", 'chat_general')):
            with self.subTest(case=case), self.assertRaises(ValueError):
                instrument_for_coverage(source, case)

    def test_numeric_deltas_never_expose_secret_strings(self):
        before = {'ok':True,'truncated':False,'counters':{
            '101:7':{'t':1,'f':0,'n':0,'o':0},
            '102:2':{'t':0,'f':1,'n':0,'o':0}}}
        after = {'ok':True,'truncated':False,'counters':{
            '101:7':{'t':1,'f':2,'n':0,'o':0},
            '102:2':{'t':0,'f':1,'n':1,'o':0},
            '103:8':{'t':1,'f':0,'n':0,'o':0}}}
        result = interpret_coverage(log_snapshots(before,after))
        self.assertEqual(result['status'], 'evaluations_observed')
        self.assertEqual(result['evaluated_positions_delta'], 3)
        self.assertEqual(result['before_positions'], 2)
        self.assertEqual(result['top_expression_deltas'][0]['line'], 102)
        self.assertEqual(result['top_expression_deltas'][0]['null_or_error'], 1)
        self.assertEqual(result['top_expression_deltas'][1]['false'], 2)
        self.assertNotIn('private-personal-text', str(result))

    def test_fail_closed_on_missing_malformed_non_monotonic(self):
        valid = {'ok':True,'truncated':False,'counters':{
            '15:5':{'t':2,'f':0,'n':0,'o':0}}}
        smaller = {'ok':True,'truncated':False,'counters':{
            '15:5':{'t':1,'f':0,'n':0,'o':0}}}
        self.assertEqual(interpret_coverage(log_snapshots(valid,smaller))['status'],
                         'non_monotonic_coverage')
        self.assertEqual(interpret_coverage('unexpected')['status'], 'unavailable')
        self.assertEqual(interpret_coverage(log_snapshots(
            valid,{'ok':False,'counters':{}}))['status'],'unavailable')
        self.assertEqual(interpret_coverage(log_snapshots(valid,valid) +
                         'QA_RULECOV_after:' + json.dumps(valid))['status'],
                         'invalid_coverage_markers')

    def test_nested_emulator_boolean_values_are_not_leaked(self):
        import shutil
        import subprocess
        if not shutil.which('node'):
            self.skipTest('node not available for JS coverage decoder')
        sample = "const row=" + json.dumps({
            "expressionReports": [
                {"sourcePosition":{"line":33,"column":4},"values":[{"count":2,"value":{"value":{"boolValue":False}}}]},
                {"sourcePosition":{"line":34,"column":5},"values":[{"count":3,"value":{"booleanValue":True}}]},
                {"sourcePosition":{"line":35,"column":6},"values":[{"count":1,"value":{"nullValue":0}}]}
            ]}) + ";console.log(JSON.stringify(qaSanitizeCoverage(row)));"
        p = subprocess.run(['node', '--input-type=module', '-e', JS_PROBE + sample],
                           capture_output=True, text=True, timeout=15)
        self.assertEqual(p.returncode, 0, p.stderr)
        report = json.loads(p.stdout)
        self.assertEqual(report['counters']['33:4']['f'], 2)
        self.assertEqual(report['counters']['34:5']['t'], 3)
        self.assertEqual(report['counters']['35:6']['n'], 1)

    def test_oversized_log_is_not_retained(self):
        from scripts.ci_historic_firestore_coverage import COVERAGE_MAX_LOG
        result = interpret_coverage('SECRET=' + 'z'*(COVERAGE_MAX_LOG+1))
        self.assertEqual(result['status'], 'unavailable_or_log_too_large')
        self.assertNotIn('z', str(result))


if __name__ == '__main__':
    unittest.main()
