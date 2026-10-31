# Átrio Guardião V2 — integração segura ao aplicativo Android

Em desenvolvimento na PR #46, sem merge, sem deploy de regras Firestore.

## Alterações de baixo risco
- GuardianNoticeFeed.kt e GuardiaoAppealsScreen.kt portados da PR #44, com isolamento de sessão, logout e recurso humano já testados em QA.
- GuardianCaseOverview.kt: apenas leitura dos últimos 30 casos no painel administrativo existente, sem botões de ativação, remoção automática ou controles do Worker.
- ModerationScreen.kt: mostra visão dos casos somente depois de autorização administrativa validada.
- Regras testadas na PR #44 para guardian_cases, guardian_notices, guardian_config, guardian_audit e guardian_runtime. Leitura restrita ao destinatário ou admin; nenhuma criação ou modificação via APK.
- Reaproveita o teste de regras da PR #44 (guardian-v2.test.mjs) no emulador Firestore já utilizado no workflow, sem duplicar a execução.

## Restrições
- O motor autônomo e o Worker permanecem desligados, por ausência de identidade de servidor contínua segura e gratuita.
- Regras adicionadas somente ao código; não aplicadas no Firebase oficial. Cloudflare, Play Store, backups e faturamento inalterados.
- O contador pode permanecer vazio até existir integração remota aprovada.
- Não importar GuardianClient e botões remotos da PR #44 enquanto a identidade e o backend não estiverem homologados. Não permitir retenção automática.
- Não fazer merge da PR #46 sem validação dos novos testes Android/Firestore e autorização de integração.
