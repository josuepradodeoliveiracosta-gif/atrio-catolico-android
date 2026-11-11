# Etapa 2 — concorrência inteligente para PRs (2026-11-11)

**Escopo:** reduzir filas de verificações obsoletas sem retirar testes nem alterar a proteção da branch `main`. Repositório público com runners padrão gratuitos; a meta é reduzir espera e preservar a segurança, não economizar franquia de minutos.

## Estado observado antes da mudança

- CodeQL: quatro linguagens já rodam com `max-parallel: 4`, sem depender do contrato; preservados.
- Selos: `Compilar Android de testes` e `Regras de seguranca Firestore` já são jobs independentes; preservados.
- Dependências: `dependency-review` e `npm-audit-diff` dependem do contrato de política. Nos logs de PRs recentes, o contrato consumiu 2–4s e os jobs seguintes começaram cerca de 5–6s depois de sua conclusão, mas **não são o caminho crítico geral enquanto CodeQL Kotlin durar mais**.
- A checagem de versão (`conferir-versao.yml`) agrupava execuções por ref e desabilitava cancelamento. Revisões rápidas da mesma PR podiam manter verificações antigas ocupando fila, e `push`/`workflow_dispatch` na `main` compartilhavam um grupo.

Exemplos de execução de dependências: [PR #237, run 43050138131](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43050138131), [PR #239, run 43051543482](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43051543482), [PR #240, run 43055122270](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43055122270). Tempos extraídos dos logs dos jobs; não representam benchmark controlado.

## Mudança proposta: cancelar somente PR antiga

Os workflows `conferir-versao.yml` e `dependency-review.yml` passam a usar:

```yaml
concurrency:
  group: atrio-<workflow>-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

O grupo real usa um prefixo diferente por workflow (`atrio-version-` e `atrio-dependency-`) e nunca colide entre PRs.

- **PR atualizada:** o commit novo cancela apenas uma execução obsoleta da **mesma PR** nesse workflow. Todos os jobs exigidos reiniciam para o commit novo.
- **PRs diferentes:** nunca competem pelo mesmo grupo de concorrência lógica.
- **`push` e `workflow_dispatch`:** têm identificador exclusivo por `run_id`, portanto não são cancelados e não se bloqueiam mutuamente pelo grupo.
- **Segurança:** nenhuma permissão nova, `if` de bypass, segredo, deploy, publicação, mudança de Gradle, Node, Firebase, Cloudflare ou backup.
- **Cobertura:** `dependency-review`, `npm-audit-diff` e seu `contract` permanecem, inclusive `needs: contract` e `fail-on-severity: high`. Não se adicionam runners ao pico de atividade para ganhar segundos incertos.
- **Contrato obrigatório:** `scripts.test_dependency_review_contract` é executado também no check obrigatório `Regras de seguranca Firestore`, além do próprio workflow de dependências; o contrato de concorrência de versão integra `scripts.test_ci_optimization_contract` já obrigatório.

## Validação e critérios de aceite

1. PR inclui somente dois workflows de CI, dois arquivos de contrato, `selos-ci.yml` e este documento.
2. `Regras de seguranca Firestore`, build Android, versionamento, segurança pública, dependências e as quatro análises CodeQL devem terminar com sucesso antes do merge.
3. As execuções manuais, programadas e de `main` continuam independentes, sem substituição acidental.
4. Comparar uma amostra futura de PRs com múltiplos commits para identificar cancelamento seletivo e redução de fila, distinguindo duração de jobs, espera por runner e eventos obsoletos.
5. **Sem prometer ganho percentual ou nota 9,5/10:** esta mudança controla concorrência lógica, não elimina o gargalo de compilação Kotlin.

A PR não publica APKs e não altera o código de produção. Caso haja regressão de checks ou interrupção inadequada, reverter a política de concorrência com uma PR específica.
