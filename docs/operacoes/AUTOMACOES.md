# GitHub Actions — organização e custo-benefício

Nesta etapa **não foram alterados workflows, gatilhos, permissões ou secrets**. Uma otimização que deixe de executar testes críticos não é uma economia aceitável.

| Grupo | Arquivos encontrados na `main` |
| --- | --- |
| Versão e segurança | `conferir-versao.yml`, `security-audit.yml` |
| Android / QA | `build-apk.yml`, `selos-ci.yml`, `android-bots-ui.yml`, `qa-official-apk.yml`, `qa-official-checks.yml` |
| Guardião — testes | `guardiao-v2-motor-ci.yml`, `guardiao-v2-shadow-ci.yml`, `guardiao-v2-fluxo-emulador-ci.yml`, `guardiao-v2-android-ui-ci.yml`, `guardiao-v2-executor-preflight.yml` |
| Guardião — operações | `guardiao-v2-qa-wif-manual.yml`, `guardiao-v2-moderator-runner.yml`, `guardiao-v2-prod-runner.yml` |
| Avatar / Push | `avatar-cloudinary-ci.yml`, `avatar-live-debug-ci.yml`, `cloudflare-push-ci.yml` |
| OTA | `ota-apk-preflight.yml`, `ota-publish-release.yml`, `ota-upgrade-qa.yml` |

**Fotografia de 04/11/2026: 21 workflows na `main`.** A PR #71 contém outros workflows em desenvolvimento.

## Estudo recomendado (ainda não implementado)

- Mapear quais diretórios, scripts e regras são testados por cada job.
- Medir duração, custo e execução desnecessária por módulo.
- Avaliar cache, agrupamento, reutilização e filtros por caminho, mantendo testes de dependências compartilhadas e segurança.
- **Não** remover gates de produção, assinatura, Firestore, privacidade ou moderação.
- Qualquer alteração em `.github/workflows/` exige PR técnica distinta, revisão dos `on:`, `permissions:`, secrets e critérios para disparos manuais.

[Índice](../INDEX.md).
