# Fluxo econômico e seguro — GitHub do Átrio Católico

**Status:** mudança proposta na PR draft #193. Não autoriza merge,
deploy, release, alteração de regras de produção ou backup.

## Diagnóstico verificado em 10/11/2026

- Na auditoria, a PR #193 tinha **247 commits e 81 arquivos modificados**.
- Filtros `pull_request.paths` consideram o *diff acumulado* da PR. Por
  isso, diversos workflows são disparados mesmo quando o último commit
  alterou apenas um teste. Não é seguro adicionar simplesmente filtros
  mais estreitos nos checks obrigatórios.
- A ruleset ativa da `main` exige os cinco checks:
  `Detectar segredos em arquivos e histórico Git`,
  `Evitar regressão de versionCode e versionName`,
  `Regras de seguranca Firestore`, `Compilar Android de testes` e
  `Bloquear exclusoes em massa (Atrio)`.
  Esses checks permanecem **obrigatórios**.

## Procedimento de trabalho recomendado

1. Definir objetivo verificável e arquivos afetados, riscos e testes.
2. Ler SHA de `main` e da branch; não sobrescrever alterações concorrentes.
3. Agrupar alteração + testes + documentação numa unidade coerente;
   validar sintaxe e testes offline quando possível no Termux ou ambiente
   isolado, sem simular que testes não executados foram aprovados.
4. Publicar um commit/push por unidade testável, em vez de um push a
   cada edição de linha. Corrigir falhas demonstradas pela CI de modo
   focal, sem mascará-las.
5. A CI da PR deve substituir execuções **obsoletas do mesmo workflow
   e da mesma PR**; execuções manuais e na `main` não são canceladas.
   Nunca usar `[skip ci]` para burlar verificação obrigatória.
6. Avaliar o SHA exato e separar estados: `success`, `failure`,
   `cancelled`, `skipped`, testes sintéticos, APK e integração real.
   Não confundir CI verde com deploy ou homologação em aparelhos.
7. Projetos/etapas novas merecem branches e PRs **pequenas e focadas**.
   Não reescrever os 247 commits da PR #193, não desmembrá-la agora,
   não alterar backups e jamais fazer merge sem autorização.

## Política implementada nesta proposta

Oito workflows recebem ou ajustam controle de concorrência:
Selos (incluindo checks obrigatórios Firestore e compilação),
Versão oficial, Bots Android, Guardião Android, QA Firestore offline,
Identidade de APK Chat QA, Segurança de repositório e Auditoria
read-only dos APKs publicados.

Para workflows de PR, a condição é:

```yaml
concurrency:
  group: grupo-especifico-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

Cada workflow usa um grupo **distinto**, evitando cancelar outros
workflows; cada PR usa seu próprio número. `workflow_dispatch` e
`push` nunca recebem a política de cancelamento. O resultado
esperado é economizar *execuções sobrepostas*, não reduzir ou
silenciar as verificações de segurança.

### Limitações e validação

- O GitHub adverte: workflow obrigatório ignorado por filtro de
  arquivos pode permanecer `Pending`; por isso os cinco checks
  necessários não receberam filtros que possam ocultá-los.
- Uma execução já encerrada não economiza minutos retroativamente;
  os benefícios só poderão ser medidos após atualizações sobrepostas.
- O GitHub Actions em uma PR grande continua rodando muitas suites.
  A verdadeira redução de custo a médio prazo é criar PRs menores
  nas próximas funcionalidades.
- Confirmar que os cinco checks exigidos passam no novo SHA e
  que produção/assinaturas/backup continuam intactos.

**Documentação oficial consultada:**
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
- https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
