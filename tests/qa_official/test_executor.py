import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import hashlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/qa_official'))
from common import accounts, digest, session_title, validate_source, Oracle, UIDS, REPO, ROOT
from run import execute, locate
from link_logins import link
import verify_apk


def bots():
    return {a: {'email': a + '@example.invalid', 'password': 'OnlyFixturePassword123!'} for a in UIDS}


class ConfigurationTests(unittest.TestCase):
    def test_exact_three_accounts(self):
        self.assertEqual(accounts(json.dumps(bots())), bots())
        for bad in ({}, {**bots(), 'admin': bots()['clara']}, {'clara': bots()['clara']}):
            with self.assertRaises(RuntimeError):
                accounts(json.dumps(bad))

    def test_invalid_password_email_and_extra_uid(self):
        for key, value in [('password', 'short'), ('password', 'A' * 20 + '\n'), ('email', 'x\n@y.z'), ('uid', 'founder')]:
            data = bots()
            data['clara'][key] = value
            with self.assertRaises(RuntimeError):
                accounts(json.dumps(data))

    def test_duplicate_email(self):
        data = bots()
        data['miguel']['email'] = data['clara']['email'].upper()
        with self.assertRaises(RuntimeError):
            accounts(json.dumps(data))

    def test_bounded_session_identifier(self):
        self.assertLess(len(session_title('qa_apk_20261027_01')), 120)
        for value in ('short', '../path/file', 'X' * 12, 'a' * 41, 'a' * 10 + '\n'):
            with self.assertRaises(RuntimeError):
                session_title(value)

    def test_digest_format(self):
        self.assertEqual(digest(':'.join(['AB'] * 32)), 'ab' * 32)
        for value in ('abc', 'g' * 64, 'a' * 63):
            with self.assertRaises(RuntimeError):
                digest(value)

    def test_only_successful_signed_build_from_own_repo(self):
        run = {'repository': {'full_name': REPO}, 'path': '.github/workflows/build-apk.yml',
               'status': 'completed', 'conclusion': 'success', 'id': 100}
        artifact = {'name': 'atrio-catolico-release-assinado', 'expired': False, 'workflow_run': {'id': 100}}
        validate_source(run, artifact)
        for key, value in [('repository', {'full_name': 'someone/fork'}), ('path', 'other.yml'),
                           ('conclusion', 'failure'), ('status', 'in_progress')]:
            with self.assertRaises(RuntimeError):
                validate_source({**run, key: value}, artifact)
        for key, value in [('name', 'debug'), ('expired', True), ('workflow_run', {'id': 99})]:
            with self.assertRaises(RuntimeError):
                validate_source(run, {**artifact, key: value})


class ProductionBarrierTests(unittest.TestCase):
    def env(self):
        return {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REPOSITORY': REPO,
                'GITHUB_RUN_ATTEMPT': '1', 'ATRIO_QA_BOTS_JSON': json.dumps(bots()),
                'QA_SESSION': 'qa_apk_fixture_01', 'QA_MODE': 'session', 'FIREBASE_WEB_API_KEY': 'fixture'}

    def test_reject_automatic_fork_rerun_and_admin_before_network(self):
        for key, value in [('GITHUB_EVENT_NAME', 'pull_request'), ('GITHUB_REPOSITORY', 'a/fork'),
                           ('GITHUB_RUN_ATTEMPT', '2'), ('GOOGLE_APPLICATION_CREDENTIALS', 'admin.json')]:
            with patch.dict(os.environ, {**self.env(), key: value}, clear=True), patch('run.Oracle') as oracle:
                with self.assertRaises(RuntimeError):
                    execute({'checks': []})
                oracle.assert_not_called()

    def test_preflight_cannot_open_ui(self):
        with patch.dict(os.environ, {**self.env(), 'QA_MODE': 'preflight'}, clear=True), \
             patch('run.Oracle') as oracle, patch('run.UI') as ui:
            oracle.return_value.query.return_value = []
            report = {'checks': []}
            execute(report)
            self.assertEqual(report['status'], 'preflight_passed_no_ui_session')
            ui.assert_not_called()

    def test_existing_session_cannot_open_ui(self):
        with patch.dict(os.environ, self.env(), clear=True), patch('run.Oracle') as oracle, patch('run.UI') as ui:
            oracle.return_value.query.return_value = [{'name': 'already-created'}]
            with self.assertRaises(RuntimeError):
                execute({'checks': []})
            ui.assert_not_called()

    def test_wrong_auth_uid_refused(self):
        with patch('common.request', return_value={'localId': 'human-account'}) as request:
            with self.assertRaises(RuntimeError):
                Oracle('fixture', bots())
            self.assertEqual(request.call_count, 1)

    def test_oracle_queries_do_not_write_documents(self):
        oracle = Oracle.__new__(Oracle)
        oracle.tokens = {'clara': 'fixture-token'}
        with patch('common.request', return_value=[]) as request:
            oracle.query('clara', 'posts', 'title', 'fixture')
            self.assertEqual(request.call_args.args[0], ROOT + ':runQuery')
            self.assertEqual(set(request.call_args.kwargs['data']), {'structuredQuery'})


class SelectorTests(unittest.TestCase):
    def node(self, **attrs):
        values = {'package': 'br.com.atriocatolico', 'enabled': 'true', 'bounds': '[0,10][100,30]', **attrs}
        return '<node ' + ' '.join(f'{k}="{v}"' for k, v in values.items()) + '/>'

    def test_exact_visible_enabled_app_control(self):
        self.assertEqual(locate('<hierarchy>' + self.node(text='Publicar discussão') + '</hierarchy>',
                                text='Publicar discussão'), (50, 20))
        for attrs in ({'package': 'other.app'}, {'enabled': 'false'}, {'bounds': '[0,0][0,0]'}):
            self.assertIsNone(locate('<hierarchy>' + self.node(text='Enviar', **attrs) + '</hierarchy>', text='Enviar'))

    def test_ambiguous_controls_abort(self):
        xml = '<hierarchy>' + self.node(text='Enviar') * 2 + '</hierarchy>'
        with self.assertRaises(RuntimeError):
            locate(xml, text='Enviar')

    def test_nested_compose_label(self):
        xml = '<hierarchy><node package="br.com.atriocatolico" enabled="true" class="android.widget.EditText" bounds="[0,0][20,20]"><node text="E-mail"/></node></hierarchy>'
        self.assertEqual(locate(xml, label='E-mail'), (10, 10))


class LinkTests(unittest.TestCase):
    class Missing(Exception):
        pass

    def fake_auth(self):
        auth = Mock()
        auth.UserNotFoundError = self.Missing
        auth.get_user.side_effect = lambda uid: SimpleNamespace(uid=uid, email=None, disabled=False)
        auth.get_user_by_email.side_effect = self.Missing
        return auth

    def test_default_does_not_modify_accounts(self):
        auth = self.fake_auth()
        link(auth, bots())
        auth.update_user.assert_not_called()

    def test_existing_different_email_stops_before_any_update(self):
        auth = self.fake_auth()
        auth.get_user.side_effect = lambda uid: SimpleNamespace(uid=uid, email='other@example.invalid', disabled=False)
        with self.assertRaises(RuntimeError):
            link(auth, bots(), apply=True)
        auth.update_user.assert_not_called()

    def test_apply_changes_only_email_password_of_fixed_uids(self):
        auth = self.fake_auth()
        link(auth, bots(), apply=True)
        self.assertEqual(auth.update_user.call_count, 3)
        self.assertEqual({c.args[0] for c in auth.update_user.call_args_list}, set(UIDS.values()))
        self.assertTrue(all(set(c.kwargs) == {'email', 'password'} for c in auth.update_user.call_args_list))


class ApkTests(unittest.TestCase):
    def verify(self, override=None):
        override = override or {}
        run = {'repository': {'full_name': REPO}, 'path': '.github/workflows/build-apk.yml',
               'status': 'completed', 'conclusion': 'success', 'id': 100, 'head_sha': 'f' * 40}
        artifact = {'name': 'atrio-catolico-release-assinado', 'expired': False, 'workflow_run': {'id': 100}}
        env = {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REPOSITORY': REPO,
               'GITHUB_RUN_ATTEMPT': '1', 'ATRIO_QA_BOTS_JSON': json.dumps(bots()), 'APK_RUN_ID': '100',
               'GH_TOKEN': 'fixture', 'APK_SHA256': hashlib.sha256(b'fixture').hexdigest(),
               'ATRIO_RELEASE_CERT_SHA256': 'a' * 64, 'ANDROID_HOME': '/sdk', 'GITHUB_ENV': 'env.txt'}
        def command(*args):
            if 'verify' in args:
                return 'Signer #1 certificate SHA-256 digest: ' + override.get('cert', 'a' * 64)
            if 'application-id' in args:
                return override.get('package', 'br.com.atriocatolico')
            if 'debuggable' in args:
                return override.get('debug', 'false')
            if 'version-name' in args:
                return '0.19.0'
            if 'project_id' in args:
                return override.get('project', 'atrio-catolico')
            return 'fixture-api-key'
        previous = os.getcwd()
        try:
            with tempfile.TemporaryDirectory() as temp:
                os.chdir(temp)
                Path('official-apk').mkdir()
                Path('official-apk/app-release.apk').write_bytes(override.get('bytes', b'fixture'))
                with patch.dict(os.environ, env, clear=True), \
                     patch('verify_apk.request', side_effect=[run, {'artifacts': [artifact]}]), \
                     patch('verify_apk.command', side_effect=command):
                    verify_apk.verify()
                    self.assertTrue(Path('qa-official-results/apk.json').exists())
        finally:
            os.chdir(previous)

    def test_signed_release_verified_without_installing(self):
        self.verify()

    def test_reject_wrong_binary_certificate_package_debug_and_project(self):
        for change in ({'bytes': b'changed'}, {'cert': 'b' * 64}, {'package': 'other.app'},
                       {'debug': 'true'}, {'project': 'demo-atrio-v11'}):
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                self.verify(change)


if __name__ == '__main__':
    unittest.main()
