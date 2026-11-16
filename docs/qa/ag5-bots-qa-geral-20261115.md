# Agente 5 — bots exclusivamente no APK QA Geral

**Data:** 15/11/2026 · **Issue:** #105 · **Origem:** PR #301 SHA `0580020338244a62c029d259271cb56fc6f723ff` · **Branch:** `test/ag5-bots-apk-qa-geral-isolado-20261115`.

## Contrato de variantes (offline, sem produção)

| Trilha | APK | Testes permitidos |
| --- | --- | --- |
| QA Geral | `qaGeral` (`br.com.atriocatolico.qageral`) | Clara, Miguel e Lúcia: UI, autenticação, publicação, respostas, notificações no Firebase Emulator `demo-atrio-v11` |
| Perfil QA | `perfilQa` (`br.com.atriocatolico.perfilqa`) | Contratos específicos de Perfil, sem suítes completas de bots |
| Conversas QA | `chatQa` (`br.com.atriocatolico.chatqa`) | Contratos específicos de Conversas, sem suítes completas de bots |
| Aplicativo oficial | Debug/release existentes | Build, unitários, segurança e regressões preservados; sem execução dos três bots contra produção |

A variante `qaGeral` só existe com `ATRIO_QA_GERAL_BUILD=1` e tarefas explícitas. Empacota UI completa do Átrio, mas com sufixo de `applicationId` próprio, assinatura de debug, push/Guardião/avatar vazios, sem instalador OTA e sem push service. Não aceita `google-services.json` de nenhum projeto, credenciais Admin ou assinatura oficial. O runner exige `ATRIO_QA_APK=qaGeral` para bots e `ATRIO_QA_FIREBASE_PROJECT=demo-atrio-v11`, com portas 9099/8089 do Emulator ligadas por ADB reverse. As três classes instrumentadas também exigem `BuildConfig.APPLICATION_ID=br.com.atriocatolico.qageral`.

A matriz Android `profiles/interaction/bots` utiliza `assembleQaGeral`, `assembleQaGeralAndroidTest` e `connectedQaGeralAndroidTest`; `GuardianV2UiTest` focal mantém sua rota Debug sem executar os bots. As suites de validação `scripts.test_chat_qa_build_gate`, `scripts.test_perfil_qa_build_gate` e `scripts.test_ag7_qa_variants_contract` continuam no CI obrigatório `selos-ci`. A compilação padrão `testDebugUnitTest/assembleDebug/assembleDebugAndroidTest`, CodeQL, scanners, versão e proteções OTA não foram modificados.

## Incidente observado na PR #301, antes desta mudança

[GitHub Actions #43664971544](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43664971544), job bots `132662212435`: `ThreeBotsAndroidUiTest` e `ThreeBotsOnlineEmulatorTest` **PASS**; `ThreeBotsAuthenticatedAndroidUiTest.claraMiguelLuciaFazemLoginPublicamRespondemERecebemAvisos` **FAIL**, `ComposeTimeoutException` após 45 s. Os grupos `profiles` e `interaction` foram aprovados. A execução usava APK Debug padrão e Firebase emulado; **não estava executando `perfilQa` ou `chatQa`**. O log resumido não comprova qual condição de `waitUntil` falhou nem a causa-raiz. Não classificar automaticamente como a falha histórica da Issue #201 e não afirmar correção sem nova execução/diagnóstico.

## Revisões e homologação pendentes

1. **Agente 5:** conferir os novos contratos offline, CI por SHA e, separadamente, compilação real `qaGeral` e 3 suítes instrumentadas; falha anterior pode persistir. Logs/artifacts devem identificar causa específica sem expor UIDs ou credenciais.
2. **Agente 2:** verificar somente a compatibilidade Auth/Firestore Emulator e rotas negadas; não abrir Rules de Perfil/Conversas para acomodar bots.
3. **Agente 4:** auditar o fail-closed do Gradle/runner e ausência de credenciais e projetos reais.
4. **Agente 7:** revisar delta da PR de QA sobre a #301 e as dependências #193, #291–#301 antes de qualquer recomendação.
5. **Fundador:** autorizações finais para merge, eventual APK físico, Firebase remoto e produção.

**Proibidos nesta entrega:** deploy, publicação, merge, dados/contas reais, Firebase remoto, serviços pagos, alteração de main e assinatura oficial. CI/emulador não equivalem a homologação em aparelho físico.
