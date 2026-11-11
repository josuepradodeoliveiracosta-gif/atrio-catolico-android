# Piloto seguro do Gradle v5 em CI Android — revisão após PR #248

**Data:** 11/11/2026. **Escopo:** somente a action `gradle/actions/setup-gradle` do job obrigatório `Compilar Android de testes` em `.github/workflows/selos-ci.yml`; sem alterar Gradle 8.13, Firebase, Cloudflare, produção, releases, OTA ou backups.

## Estado e evidência

Após a [PR #246](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/246), os logs Android passaram a identificar aviso de Node 20 apenas nas actions antigas `setup-gradle@v4` e `upload-artifact@v4`.

A [PR #248](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/248) **já incorporou** `upload-artifact@v7`, preservando nome, caminho, retenção de sete dias e `archive: true` para o APK debug de PR. Não duplicamos essa alteração.

Uma tentativa anterior, [PR #247](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/247), incluiu ambas as atualizações. Seus seis workflows e as quatro análises CodeQL passaram. No [run 43066663633](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43066663633), os logs do Android confirmaram **acerto de cache Gradle** com `setup-gradle@v5`, carregamento do `upload-artifact@v7`, nenhum aviso de Node 20 e um artefato ZIP `atrio-catolico-v0190-debug-testes` de **28.630.787 bytes**. Após o merge paralelo da PR #248, a #247 tornou-se conflitante; não forçar o merge nem sobrescrever a PR já incorporada. Este piloto substitui somente a parte Gradle, com base atualizada.

## Versão e integridade

- **Versão:** Gradle Actions `setup-gradle` **v5.0.2**, commit imutável `0723195856401067f7a2779048b490ace7a47d7c`.
- **Runtime da action:** Node 24, confirmado no `action.yml` da versão fixada.
- **Cache:** a v5 mantém o cache baseado no GitHub Actions, que apresentou acertos no experimento anterior; preservar o modo de cache e suas chaves.
- **Por que não v6:** a v6 introduziu `cache-provider: enhanced` como padrão, usando um serviço comercial externo; migrar exigiria decisão separada sobre custos, licenciamento, dados e compatibilidade. Não introduzir um serviço comercial para resolver um aviso de Node 20.
- **Por que SHA:** a revisão de CodeQL da PR #247 registrou aviso para `setup-gradle@v5` por usar tag mutável de terceiro. O SHA fixo evita essa condição sem aumentar permissões.

Fontes oficiais: [release v5.0.2](https://github.com/gradle/actions/releases/tag/v5.0.2), [ação fixada](https://github.com/gradle/actions/blob/0723195856401067f7a2779048b490ace7a47d7c/setup-gradle/action.yml), [ação v6 — cache-provider enhanced](https://github.com/gradle/actions/blob/v6/setup-gradle/action.yml).

## Mudança exata e controles

Somente `gradle/actions/setup-gradle@v4` → `gradle/actions/setup-gradle@0723195856401067f7a2779048b490ace7a47d7c` no job Android. O `scripts/test_ci_optimization_contract.py` passa a exigir o SHA, proibir o provedor `enhanced` e impedir desativação do cache.

**Intocados:** Java 17, Android SDK, API 36, Gradle 8.13, `testDebugUnitTest`, `assembleDebug`, `assembleDebugAndroidTest`, variáveis dos Workers, gatilhos, concorrência, timeout de 25 minutos e upload de APK debug somente para PRs com ZIP e retenção de sete dias. Não modificar os workflows `build-apk.yml`, `codeql-review.yml` ou os ambientes de produção.

## Aceite

1. Sucesso de todos os checks obrigatórios na PR nova (Android, Firestore, versão, segurança, dependências e quatro linguagens CodeQL).
2. Confirmar execução do SHA imutável nos logs, ausência dos avisos anteriores no job Android e **cache Gradle restaurado**.
3. Confirmar artefato de APK debug com o nome anterior e tamanho positivo no run atual, sem publicar ou assinar APK de release.
4. Não alegar ganho percentual de duração sem comparar execuções equivalentes; registrar eventual regressão antes de nova migração.

**Decisão final proposta:** atualizar apenas o Gradle de CI obrigatório, com SHA imutável e cache GitHub preservado, sem trocar de provedor nem repetir o trabalho da PR #248.
