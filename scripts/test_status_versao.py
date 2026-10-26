#!/usr/bin/env python3
import unittest
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


if __name__ == '__main__':
    unittest.main()
