"""Testes adversariais da trava contra exclusao generalizada."""
import unittest

from scripts.guard_exclusoes import Change, evaluate, parse_name_status


class GuardExclusoesTests(unittest.TestCase):
    def test_diff_normal_com_nul(self):
        data = b"M\0app/Main.kt\0D\0docs/obsoleto.md\0"
        self.assertEqual(
            parse_name_status(data),
            [Change("M", "app/Main.kt"), Change("D", "docs/obsoleto.md")],
        )

    def test_diff_nome_com_espacos_e_quebra_linha(self):
        data = b"D\0docs/arquivo com espaco\nestranho.md\0"
        self.assertEqual(len(parse_name_status(data)), 1)

    def test_diff_incompleto_falha_fechado(self):
        with self.assertRaises(ValueError):
            parse_name_status(b"D\0sem-terminador")
        with self.assertRaises(ValueError):
            parse_name_status(b"D\0")
        with self.assertRaises(ValueError):
            parse_name_status(b"R100\0origem\0destino\0")

    def test_exclusao_isolada_regular_permitida(self):
        self.assertFalse(evaluate([Change("D", "docs/antigo.md")], 100))

    def test_ao_menos_oito_exclusoes_bloqueadas(self):
        changes = [Change("D", f"docs/{index}.md") for index in range(8)]
        self.assertTrue(evaluate(changes, 500))

    def test_percentual_de_dez_por_cento_bloqueado(self):
        changes = [Change("D", f"docs/{index}.md") for index in range(3)]
        self.assertTrue(evaluate(changes, 30))

    def test_poucas_exclusoes_abaixo_de_limiar(self):
        changes = [Change("D", f"docs/{index}.md") for index in range(2)]
        self.assertFalse(evaluate(changes, 100))

    def test_nao_conhecer_quantidade_da_base_bloqueia(self):
        self.assertTrue(evaluate([], 0))

    def test_backup_protegido_mesmo_uma_exclusao(self):
        for path in (
            "backup/arquivo.txt",
            "backups/historico.json",
            "exports/pacote.md",
            "snapshots/data.json",
        ):
            with self.subTest(path=path):
                self.assertTrue(evaluate([Change("D", path)], 1000))

    def test_workflow_protegido_mesmo_uma_exclusao(self):
        self.assertTrue(
            evaluate([Change("D", ".github/workflows/build-apk.yml")], 1000)
        )

    def test_arquivos_nucleares_protegidos(self):
        for path in (
            "AGENTS.md",
            "README.md",
            "firestore.rules",
            "app/build.gradle.kts",
            ".github/CODEOWNERS",
            "scripts/guard_exclusoes.py",
        ):
            with self.subTest(path=path):
                self.assertTrue(evaluate([Change("D", path)], 1000))

    def test_edicao_da_propria_trava_proibida(self):
        for path in (
            "scripts/guard_exclusoes.py",
            ".github/workflows/proteger-repositorio.yml",
            ".github/CODEOWNERS",
        ):
            with self.subTest(path=path):
                self.assertTrue(evaluate([Change("M", path)], 1000))

    def test_adicao_inicial_da_trava_permitida(self):
        self.assertFalse(
            evaluate([Change("A", ".github/workflows/proteger-repositorio.yml")], 1000)
        )

    def test_renomeacoes_nao_podem_ocultar_exclusao(self):
        # --no-renames transforma rename em remocao+adicao.
        changes = [
            Change("D", "backup/arquivo-original.txt"),
            Change("A", "outro-destino/arquivo.txt"),
        ]
        self.assertTrue(evaluate(changes, 1000))


if __name__ == "__main__":
    unittest.main()
