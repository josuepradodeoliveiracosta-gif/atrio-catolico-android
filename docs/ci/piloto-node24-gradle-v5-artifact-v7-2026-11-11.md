# Piloto seguro: Gradle v5 e upload-artifact v7 no Android de testes

**Verificação:** 11/11/2026. **Escopo:** exclusivamente o job `Compilar Android de testes` de `.github/workflows/selos-ci.yml`. Não modifica o job Firestore, build de release, assinaturas, CodeQL, Cloudflare, Firebase real, OTA, backups ou workflows de publicação.

## Evidências antes da mudança

A [PR #246](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/246) passou em todos os checks e validou `checkout@v7` e `setup-java@v6`. O log do job Android (run 43064967093) ainda reportou aviso de runtime Node 20 **somente** das actions `gradle/actions/setup-gradle@v4` e `actions/upload-artifact@v4`.

Os lançamentos oficiais confirmam:

- `gradle/actions/setup-gradle@v5` usa runtime **Node 24** e mantém a configuração do cache GitHub anterior; v5.0.2 foi publicado em 23/02/2026.
- `gradle/actions/setup-gradle@v6` usa Node 24, **mas seu padrão mudou**: `cache-provider: enhanced` utiliza o serviço comercial `gradle-actions-caching`. **Não adotar v6 automaticamente:** evitar novos serviços, possíveis custos, envio de dados a terceiros e mudança silenciosa da política de cache.
- `actions/upload-artifact@v7` usa Node 24 e permite upload direto de arquivo com `archive: false`. **Não usar essa opção:** manter o artefato ZIP e o nome existente por compatibilidade com downloads de QA.

Fontes: [Gradle actions v5.0.0](https://github.com/gradle/actions/releases/tag/v5.0.0), [Gradle setup v6](https://github.com/gradle/actions/blob/v6/setup-gradle/action.yml), [upload-artifact v7](https://github.com/actions/upload-artifact/releases/tag/v7.0.0), [ação upload v7](https://github.com/actions/upload-artifact/blob/v7/action.yml).

## Proposta isolada

| Etapa | Antes | Piloto |
| --- | --- | --- |
| Configurar Gradle 8.13 | `gradle/actions/setup-gradle@v4` | `@v5`, sem provedores de cache externos |
| Upload do APK debug da PR | `actions/upload-artifact@v4` | `@v7`, com `archive: true` explícito |

**Invariantes:** mesma distribuição Gradle **8.13**, cache baseado no GitHub Actions, comando `gradle :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest --no-daemon --stacktrace`, Java 17, Android API 36, `checkout@v7`, mesmas variáveis e timeout. O upload continua exclusivo de PRs, com nome `atrio-catolico-v0190-debug-testes`, arquivo `app/build/outputs/apk/debug/app-debug.apk`, `if-no-files-found: error`, retenção de **7 dias** e formato ZIP. O contrato offline protege essas propriedades e proíbe `cache-provider: enhanced`.

## Critérios para merge

1. Todos os workflows da PR concluídos com sucesso: versão, segurança pública, escopo, dependências, ambos os jobs de selos (Android/Firestore) e as quatro linguagens CodeQL.
2. Log do Android confirma `setup-gradle@v5` e `upload-artifact@v7`, sem erros de runtime das duas actions antigas.
3. Confirmar via API do GitHub Actions a existência e tamanho positivo do artefato de debug **da própria PR**. Se o artefato estiver ausente, não incorporar.
4. Verificar nos logs evidência de restauração do cache Gradle. Um miss isolado pode acontecer após atualização de chave e não prova regressão por si só; não eliminar cache nem alterar chave sem teste.
5. Nenhuma permissão adicional, token, publicação, deploy, assinatura oficial, alteração de custo ou de backups.

**Decisão:** modernizar somente o CI obrigatório de testes, **não** trocar globalmente para Gradle v6 nem alterar jobs de publicação. Ganhos de velocidade continuam dependentes de medições repetidas, não apenas de atualização de versão.
