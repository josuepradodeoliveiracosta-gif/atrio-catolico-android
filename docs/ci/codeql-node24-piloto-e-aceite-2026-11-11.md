# Modernização do CodeQL para actions Node 24 — piloto controlado

**Data:** 11/11/2026. **Escopo:** exclusivamente `.github/workflows/codeql-review.yml` e seu teste de contrato. Sem modificações no aplicativo, compilação dos APKs da `main`, OTA, release, ambientes Firebase/Cloudflare, credenciais ou backups.

## Evidências antes da alteração

- No [run CodeQL main 43068713087](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43068713087), as quatro linguagens e o contrato passaram. O log Kotlin mostrou avisos da plataforma: `setup-java v4 is deprecated` e `Node.js 20 is deprecated`, referindo-se a `checkout@v4`, `setup-java@v4` e `setup-gradle@ed408507... (v4.4.3)`.
- O log Kotlin também comprovou acertos de cache Gradle (distribuição, dependências, transformações, DSL). Por isso, **não desabilitar cache** para acelerar a análise.
- A [PR #250](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/250) já validou `gradle/actions/setup-gradle` **v5.0.2 fixado em SHA** no job Android obrigatório, sem migrar para v6 ou para provedor comercial de cache.
- As [PRs #245](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/245) e [#246](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/246) validaram `checkout@v7` e `setup-java@v6` nos jobs obrigatórios.

## Mudança isolada

| Action | Antes | Depois |
| --- | --- | --- |
| Checkout (contrato e matriz) | `actions/checkout@v4` | `actions/checkout@v7` |
| Java (somente Kotlin) | `actions/setup-java@v4` | `actions/setup-java@v6` |
| Gradle (somente Kotlin) | `gradle/actions/setup-gradle@ed408507eac070d1f99cc633dbcf757c94c7933a` | `gradle/actions/setup-gradle@0723195856401067f7a2779048b490ace7a47d7c` |

O SHA v5.0.2 do Gradle é o mesmo fixado e já validado na `main`; não usar tag mutável de terceiro. `setup-java@v6` configura **Java 17**, não Java 24. As actions novas usam Node 24 internamente.

### Proteções explicitamente preservadas

- Matriz completa: `javascript-typescript`, `python`, `actions` e `java-kotlin`; análise `security-and-quality`, Kotlin `build-mode: manual`, categorias de diagnóstico originais e `fail-fast: false`.
- Contrato de segurança em paralelo à matriz e também no check obrigatório Firestore; `max-parallel: 4`; sem adicionar filas ou cancelar eventos da `main`.
- Android SDK 36, Gradle **8.13**, Java **17**, `gradle :app:assembleDebug --no-daemon --stacktrace`, variáveis de assinatura vazias para Kotlin, `python3 scripts/validar_firebase.py` e nenhuma chave de assinatura.
- `persist-credentials: false` nos dois checkouts; `contents: read` global, `actions: read` e `security-events: write` limitados à análise. Sem `id-token: write`, `pull_request_target` ou permissão adicional.
- O componente do cache Gradle segue usando GitHub Actions. **Não migrar para `gradle/actions@v6`**, pois sua estratégia `enhanced` comercial exige avaliação separada de dados, contratos, custo e compatibilidade.

## Aceite verificável

1. Na PR, todos os seis workflows obrigatórios aprovados, incluindo Firestore/Android, dependências, versão, segurança e escopo.
2. Dentro do CodeQL, **quatro linguagens** e o contrato passam; Kotlin compila Debug normalmente e envia diagnósticos.
3. Log Kotlin comprova `checkout@v7`, `setup-java@v6` e Gradle no SHA pinado, **sem os avisos de Node 20 e de `setup-java v4` atribuídos a essas actions**; os caches permanecem funcionais.
4. A PR contém somente o workflow CodeQL, seu teste offline e este documento. Nenhuma mudança de configuração de produção, release ou secrets.
5. Após incorporar, observar a `main` e comparar execuções, sem afirmar aceleração por uma amostra isolada.

## Critério de parada da otimização

A meta combinada é **9,0/10**, não 9,5. A nota é uma **avaliação técnica com pesos consistentes**, não uma certificação externa nem garantia de melhoria percentual. Ao confirmar os checks e ausência de regressão relevante, encerrar a fase de otimização; corrigir futuros incidentes de segurança será manutenção, não busca permanente de nota.

Leitura complementar: [comparativo de 32 execuções](comparativo-pre-pos-actions-2026-11-11.md).
