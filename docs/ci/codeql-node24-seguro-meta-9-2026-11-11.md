# Meta 9,0 — modernização controlada do CodeQL para Node 24

**Data:** 11/11/2026. **Escopo:** somente `.github/workflows/codeql-review.yml`, contrato offline e documentação. Não altera APK, assinatura, release, OTA, Firebase, Cloudflare, backups, segredos ou jobs de publicação.

## Linha de base e evidências

A [auditoria pré/pós](comparativo-pre-pos-actions-2026-11-11.md) demonstrou que a velocidade **não melhorou de forma consistente**: CodeQL `main` teve mediana de 247,5 s até o último job antes, contra 252 s depois (n=12 e n=4; amostra não controlada). O Kotlin continua sendo o caminho crítico, e as filas são normalmente pequenas.

No [CodeQL `main` run 43068713087](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43068713087), houve **acertos de cache Gradle**, mas o log ainda informou depreciação de `checkout@v4`, `setup-java@v4` e `setup-gradle@v4.4.3` por usarem runtime Node 20. Os quatro analisadores estavam aprovados.

## Alteração restrita ao CodeQL

| Ação | Antes | Piloto |
| --- | --- | --- |
| Checkout (contrato e matriz) | `actions/checkout@v4` | `actions/checkout@v7` |
| Java para Kotlin | `actions/setup-java@v4` | `actions/setup-java@v6` |
| Gradle para Kotlin | SHA de v4.4.3 | SHA fixo de v5.0.2: `0723195856401067f7a2779048b490ace7a47d7c` |

O SHA foi **previamente validado** em [PR #250](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/250) no job Android obrigatório. `gradle/actions/setup-gradle@v5` usa Node 24 e preserva o cache baseado no GitHub; não usamos o modo `enhanced` introduzido pela linha v6, nem adotamos serviço comercial ou condições de cache diferentes.

**Invariantes mantidas:** checkout sem credenciais persistentes nos dois jobs, Java 17, Gradle 8.13, SDK 36, build Android debug instrumentalizado e sem segredos de assinatura, `queries: security-and-quality`, quatro linguagens `javascript-typescript`, `python`, `actions`, `java-kotlin`, `max-parallel: 4`, análise Kotlin manual, contrato de segurança obrigatório em CI e `security-events: write` restrito à análise. O CodeQL `init@v4` e `analyze@v4` não mudam.

## Testes de regressão e critérios de aceite

1. `scripts/test_codeql_review_workflow.py` exige as versões modernizadas, o SHA completo, os dois checkouts sem credenciais, os quatro analisadores e a ausência de `cache-provider: enhanced` e `cache-disabled: true`.
2. Na PR, exigir sucesso das quatro linguagens CodeQL, testes Android e Firestore, versão, dependências, verificação do repositório público e revisão de escopo; **sem bypass de rulesets**.
3. Confirmar nos logs que as três actions atualizadas carregaram e que não há aviso Node 20 associado a elas.
4. Confirmar Kotlin manual compilado/analisado, Java 17/Gradle 8.13, acerto ou restauração segura de cache quando disponível; não tratar o primeiro cache miss após atualizar action como regressão sem investigar.
5. Não alegar redução de segundos ou ponto extra na nota apenas pela migração: concluir a meta 9,0 exige **ausência de regressões e checagem final de estabilidade**.

## Limites e rollback

Caso falhem os checks, preservar a `main` e corrigir ou reverter apenas esta PR. Manter os workflows de APK oficial/manual e OTA **fora do escopo**: contêm travas de assinatura e publicação e não devem ser alterados para eliminar avisos cosméticos.

Referências oficiais: [checkout](https://github.com/actions/checkout), [setup-java](https://github.com/actions/setup-java), [Gradle Actions v5.0.2](https://github.com/gradle/actions/releases/tag/v5.0.2), [guia de caches Gradle](https://github.com/gradle/actions/blob/main/docs/setup-gradle.md).
