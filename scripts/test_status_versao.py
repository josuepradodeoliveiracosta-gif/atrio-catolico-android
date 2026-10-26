#!/usr/bin/env python3
import unittest
import base64
import io
from contextlib import redirect_stdout
from unittest.mock import patch
import status_versao
from status_versao import parse_gradle, compare_versions


class StatusVersaoTests(unittest.TestCase):
    def test_extrai_apenas_do_gradle(self):
        self.assertEqual(parse_gradle('''
        versionCode = 24
        versionName = "0.18.0"
        '''), (24, '0.18.0'))

    def test_ignora_citacao_de_numero_em_comentarios(self):
        code, name = parse_gradle('''// versão 0.4 é histórica
        versionCode = 25
        versionName = "0.19.0"
        ''')
        self.assertEqual((code, name), (25, '0.19.0'))

    def test_rejeita_ausencia_ou_duplicacao(self):
        with self.assertRaises(ValueError):
            parse_gradle('versionName = "0.18.0"')
        with self.assertRaises(ValueError):
            parse_gradle('versionCode = 24\nversionCode = 23\nversionName = "0.18.0"')

    def test_rejeita_versao_invalida(self):
        with self.assertRaises(ValueError):
            parse_gradle('versionCode = 0\nversionName = "0.18.0"')
        with self.assertRaises(ValueError):
            parse_gradle('versionCode = 24\nversionName = "0.18"')

    def test_documentacao_sem_codigo_nao_exige_nova_versao(self):
        self.assertTrue(compare_versions((24, '0.18.0'), (24, '0.18.0')))

    def test_versao_nova_precisa_ambos_crescerem(self):
        self.assertTrue(compare_versions((25, '0.19.0'), (24, '0.18.0')))
        with self.assertRaises(ValueError):
            compare_versions((25, '0.18.0'), (24, '0.18.0'))
        with self.assertRaises(ValueError):
            compare_versions((24, '0.19.0'), (24, '0.18.0'))

    def test_rejeita_regressao(self):
        with self.assertRaises(ValueError):
            compare_versions((23, '0.17.0'), (24, '0.18.0'))
        with self.assertRaises(ValueError):
            compare_versions((25, '0.17.0'), (24, '0.18.0'))
        with self.assertRaises(ValueError):
            compare_versions((23, '0.19.0'), (24, '0.18.0'))


class RemoteStatusTests(unittest.TestCase):
    sha = 'a' * 40

    def remote(self, path):
        self.calls.append(path)
        if path == 'branches/main':
            return {'commit': {'sha': self.sha}}
        if path == f'contents/app/build.gradle.kts?ref={self.sha}':
            return {'encoding': 'base64', 'content': base64.b64encode(
                b'versionCode = 24\nversionName = "0.18.0"').decode()}
        if path.startswith('actions/workflows/build-apk.yml/runs?'):
            self.assertIn('head_sha=' + self.sha, path)
            return {'workflow_runs': self.runs}
        if path.startswith('actions/runs/10/artifacts?'):
            return {'artifacts': self.artifacts}
        if path.startswith('pulls?'):
            return [{'number': 15, 'title': 'Proposta 0.19.0',
                     'head': {'ref': 'feature/push'}, 'draft': False}]
        raise AssertionError('Consulta inesperada: ' + path)

    def setUp(self):
        self.calls = []
        self.runs = [{'id': 10, 'head_sha': self.sha, 'head_branch': 'main',
                      'status': 'completed', 'conclusion': 'success', 'html_url': 'build-url'}]
        self.artifacts = [{'id': 20, 'name': 'atrio-catolico-release-assinado',
                           'expired': False, 'size_in_bytes': 100,
                           'workflow_run': {'head_sha': self.sha}}]

    def status(self):
        with patch.object(status_versao, 'api', side_effect=self.remote):
            return status_versao.status_remoto()

    def test_fixa_gradle_e_build_no_mesmo_commit(self):
        result = self.status()
        self.assertEqual(result['versionName'], '0.18.0')
        self.assertEqual(result['commit'], self.sha)
        self.assertTrue(result['apk_disponivel'])
        self.assertNotIn('contents/app/build.gradle.kts?ref=main', self.calls)
        self.assertEqual(result['propostas'][0]['numero'], 15)

    def test_build_success_sem_release_nao_confirma_apk(self):
        self.artifacts = []
        self.assertFalse(self.status()['apk_disponivel'])

    def test_artefato_expirado_vazio_debug_ou_outro_commit_nao_confirma(self):
        for key, value in [('expired', True), ('size_in_bytes', 0),
                           ('name', 'atrio-catolico-firebase-apk'),
                           ('workflow_run', {'head_sha': 'b' * 40})]:
            with self.subTest(key=key):
                self.setUp()
                self.artifacts[0][key] = value
                self.assertFalse(self.status()['apk_disponivel'])

    def test_build_de_outro_commit_nao_e_atual(self):
        self.runs[0]['head_sha'] = 'b' * 40
        result = self.status()
        self.assertIsNone(result['build'])
        self.assertFalse(result['apk_disponivel'])

    def test_execucao_pendente_ou_falha_nao_confirma_release(self):
        for state, conclusion in [('in_progress', None), ('completed', 'failure')]:
            with self.subTest(state=state):
                self.runs[0].update(status=state, conclusion=conclusion)
                self.assertFalse(self.status()['apk_disponivel'])
                self.assertFalse(any('/artifacts?' in p for p in self.calls))

    def test_escolhe_execucao_mais_recente_do_commit(self):
        self.runs.append(dict(self.runs[0], id=11, status='in_progress', conclusion=None))
        self.assertEqual(self.status()['build']['status'], 'in_progress')

    def test_remoto_independe_de_gradle_local(self):
        with patch.object(status_versao, 'api', side_effect=self.remote), \
             patch.object(status_versao.Path, 'read_text', side_effect=OSError('Cópia antiga')), \
             patch('sys.argv', ['status_versao.py']), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(status_versao.main(), 0)
            self.assertIn('VERSÃO PRINCIPAL (main): 0.18.0', output.getvalue())
            self.assertIn('APK RELEASE DISPONÍVEL', output.getvalue())

    def test_falha_remota_nao_recua_para_versao_local(self):
        with patch.object(status_versao, 'api', side_effect=RuntimeError('Sem conexão')):
            with self.assertRaises(RuntimeError):
                status_versao.status_remoto()

    def test_validate_base_usa_commit_anterior_explicito(self):
        gradle = 'versionCode = 24\nversionName = "0.18.0"'
        with patch.object(status_versao.Path, 'read_text', return_value=gradle), \
             patch.object(status_versao, 'run', return_value=gradle) as command, \
             patch('sys.argv', ['status_versao.py', '--validate-base', '--base-ref', self.sha]), \
             redirect_stdout(io.StringIO()):
            self.assertEqual(status_versao.main(), 0)
            command.assert_called_once_with(['git', 'show', self.sha + ':app/build.gradle.kts'])


if __name__ == '__main__':
    unittest.main()

