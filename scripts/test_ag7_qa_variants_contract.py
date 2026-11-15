"""Contratos estaticos de convivencia das variantes QA; sem rede nem APK."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
GRADLE = (ROOT / "app/build.gradle.kts").read_text(encoding="utf-8")


class QaVariantsCoexistenceContract(unittest.TestCase):
    def test_duas_variantes_com_pacotes_distintos(self):
        self.assertEqual(GRADLE.count('create("chatQa")'), 1)
        self.assertEqual(GRADLE.count('create("perfilQa")'), 1)
        chat = GRADLE.split('create("chatQa")', 1)[1].split('create("perfilQa")', 1)[0]
        perfil = GRADLE.split('create("perfilQa")', 1)[1].split('create("otaPilot")', 1)[0]
        self.assertIn('applicationIdSuffix = ".chatqa"', chat)
        self.assertIn('applicationIdSuffix = ".perfilqa"', perfil)
        self.assertIn('matchingFallbacks += listOf("debug")', chat)
        self.assertIn('matchingFallbacks += listOf("debug")', perfil)
        self.assertIn('PUSH_RELAY_URL', perfil)
        self.assertNotIn('System.getenv("ATRIO_CHAT_QA_WORKER_URL")', perfil)

    def test_opt_in_separado_e_rejeicao_de_ativacao_simultanea(self):
        for flag, variant in [
            ("ATRIO_CHAT_QA_BUILD", "chatQa"),
            ("ATRIO_PERFIL_QA_BUILD", "perfilQa"),
        ]:
            self.assertIn(f'System.getenv("{flag}") == "1"', GRADLE)
            self.assertIn(f'beforeVariants(selector().withBuildType("{variant}"))', GRADLE)
            self.assertIn(f'onVariants(selector().withBuildType("{variant}"))', GRADLE)
            self.assertIn(f'assemble{variant[0].upper()}{variant[1:]}', GRADLE)
        self.assertIn('System.getenv("ATRIO_PERFIL_QA_BUILD") != "1"', GRADLE)
        self.assertIn('System.getenv("ATRIO_CHAT_QA_BUILD") != "1"', GRADLE)
        self.assertIn('!atrioDesignPreview && !atrioOtaQaLoopback && !atrioOtaPilotEnabled', GRADLE)

    def test_google_services_e_preflight_sao_separados(self):
        self.assertRegex(GRADLE, r'file\("google-services.json"\)\.exists\(\)\s*\|\|\s*atrioPerfilQaBuild\s*\|\|\s*atrioChatQaBuild')
        self.assertIn('src/chatQa/google-services.json', GRADLE)
        self.assertIn('src/perfilQa/google-services.json', GRADLE)
        self.assertIn('scripts/chat_qa_build_gate.py', GRADLE)
        self.assertIn('scripts/perfil_qa_build_gate.py', GRADLE)
        for path in ["chatQa", "perfilQa"]:
            self.assertIn(f'/app/src/{path}/google-services.json',
                          (ROOT / ".gitignore").read_text(encoding="utf-8"))

    def test_ambas_as_variantes_herdam_debug_e_nao_assinatura_oficial(self):
        for variant in ["chatQa", "perfilQa"]:
            segment = GRADLE.split(f'create("{variant}")', 1)[1].split('        }\n', 1)[0]
            self.assertIn('initWith(getByName("debug"))', segment)
            self.assertIn('isDebuggable = true', segment)
            self.assertNotIn('signingConfigs.findByName("atrioRelease")', segment)
        self.assertIn('create("otaPilot")', GRADLE)
        self.assertIn('getByName("release")', GRADLE)
        self.assertIn('getByName("debug")', GRADLE)

    def test_manifests_qa_sem_backup(self):
        for variant in ["chatQa", "perfilQa"]:
            m = (ROOT / f"app/src/{variant}/AndroidManifest.xml").read_text(encoding="utf-8")
            self.assertIn('android:allowBackup="false"', m)
            self.assertIn('android:label=', m)


if __name__ == "__main__":
    unittest.main()
