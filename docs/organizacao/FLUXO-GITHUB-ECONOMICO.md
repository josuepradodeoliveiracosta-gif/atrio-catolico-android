# Fluxo GitHub — qualidade, rastreabilidade e segurança

**Estado:** proposta na PR draft #193, sem merge ou implantação.
**Nome de arquivo legado:** `FLUXO-GITHUB-ECONOMICO.md` permanece para não
quebrar referências existentes; o objetivo atual **não é poupar minutos**.

## Constatações auditadas em 10/11/2026

- O repositório é público. GitHub Actions com **runners padrão hospedados
  pelo GitHub** é gratuito e tem minutos ilimitados em repositórios públicos.
  Runners maiores, armazenamento e outras cotas são assuntos separados.
- A PR #193 já havia acumulado 248 commits e 88 arquivos modificados na
  auditoria. Filtros `pull_request.paths` comparam o conjunto de alterações
  da PR, não apenas o último commit.
- A ruleset de `main` exige cinco verificações:
  `Detectar segredos em arquivos e histórico Git`,
  `Evitar regressão de versionCode e versionName`,
  `Regras de seguranca Firestore`,
  `Compilar Android de testes`,
  `Bloquear exclusoes em massa (Atrio)`.
  **Todos os cinco checks e seus nomes são preservados.**

## Procedimento de desenvolvimento

1. Definir uma unidade funcional verificável: objetivo, código, testes,
   casos negativos, revisão de segurança e evidência esperada.
2. Fixar os SHA de `main` e branch; não sobrescrever trabalhos paralelos.
3. Preparar mudanças correlatas com testes e documentação no mesmo
   conjunto. Rodar verificações locais/Termux quando viável, sem alegar
   testes não executados.
4. Realizar um push/commit por conjunto coerente, mantendo correções de
   falhas comprovadas em commits próprios quando necessário. Evitar
   longas cadeias de microalterações na PR.
5. Executar **testes completos e independentes em paralelo**. Para
   workflows de CI sem efeitos persistentes, cada execução de PR tem
   um grupo de concorrência exclusivo pelo `github.run_id`, sem
   cancelamento automático. Isso preserva a auditoria por SHA.
6. Conferir resultados por commit: `success`, `failure`, `pending`,
   `cancelled` e `skipped` não são equivalentes. CI offline não é
   implantação, FCM real ou homologação física.
7. Adotar branches e PRs **pequenas e focadas** para novas tarefas.
   Não reescrever os commits ou dividir a PR #193 sem autorização.
   Integrar à `main` somente após verificação e aprovação específicas.

## Política de concorrência revisada

O cancelamento automático implantado em 8 workflows de QA no commit
`2cd67d5` foi reavaliado: a economia de minutos não é um objetivo
válido para os runners padrão deste repositório público, enquanto
a interrupção de suites Android e Firestore dificulta diagnósticos.

Para **CI independente e sem deploy**, a configuração aceita é:

```yaml
concurrency:
  group: nome-do-workflow-${{ github.event_name == 'pull_request' && github.run_id || github.ref }}
  cancel-in-progress: false
```

Isso evita que um novo commit de PR interrompa outro teste ou substitua
uma execução ainda pendente. Outras PRs continuam isoladas. O grupo
tradicional por `github.ref` pode permanecer em eventos de `push`
e `workflow_dispatch`, conforme a segurança de cada workflow.

**Exceções intencionais:** Workflows de assinatura, Release, deploy,
Guardião com acesso a sistemas reais e proteção de exclusões mantêm
seus controles de serialização e aprovação. Não remover travas de
produção em nome do paralelismo.

## Segurança e limites

- Não alterar exigências ou nomes de required checks, criar bypass por
  `[skip ci]` nem tornar automáticas ações de publicação/produção.
- A PR #193 contém testes de laboratório e evidências acumuladas; a
  política do chat 18+, moderação e retenção ainda bloqueia rollout.
- Uma melhora de concorrência não garante que todos os workflows
  disparem para todos os arquivos. Os filtros e gates são preservados.
- Revisar `pull_request_target` e políticas de execução do GitHub em
  auditoria própria, sem trocar a fonte confiável do verificador de
  exclusões sem prova de equivalência.
- Os minutos gratuitos não dispensam atenção a limites de concorrência,
  cotas de armazenamento e possíveis custos de runners maiores.

**Fontes oficiais:**
https://docs.github.com/en/actions/concepts/billing-and-usage
https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency
https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
