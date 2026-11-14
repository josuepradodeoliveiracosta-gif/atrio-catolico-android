# Átrio Católico — concorrência inteligente de QA por PR (etapa pontual)

**Data:** 13/11/2026. **Base auditada:** `main` no SHA `42969d1ae5f5f50e43db4471a1265102ab02bded`.  
**Meta solicitada:** buscar nível **10/10 em paralelismo e concorrência**, **sem atribuir uma nota definitiva sem medição comparável**.  
**Escopo:** exclusivamente cinco workflows opcionais de QA e um contrato de testes offline; sem mexer em regras de publicação, proteção da `main`, CodeQL, diagnóstico, Guardião de produção ou Firestore de produção.

## 1. Comportamentos verificados no código anterior

- `ota-upgrade-qa.yml` usava `group: ota-qa-upgrade-${{ github.event.pull_request.number || github.ref }}` com `cancel-in-progress: true`. Assim, **duas execuções manuais na mesma ref podiam cancelar-se**; não havia distinção entre revisão obsoleta e execução manual independente.
- `android-bots-ui.yml`, `guardiao-v2-android-ui-ci.yml` e `cloudflare-push-ci.yml` compartilhavam um grupo por PR ou `github.ref` e usavam `cancel-in-progress: false`. Essa opção preserva a execução atual, porém **não garante que todas as execuções pendentes da mesma referência sobrevivam à substituição de fila**; alterações de PR podiam continuar consumindo emuladores de commits já superados.
- `ota-in-app-qa.yml` já limitava cancelamento a `pull_request`, mas ainda agrupava execuções manuais por `github.ref`. Isso podia serializar a fila manual, e um run mais recente podia substituir um pendente antigo mesmo sem `cancel-in-progress: true`.
- Os workflows principais `selos-ci.yml`, `codeql-review.yml`, `dependency-review.yml` e `conferir-versao.yml` **já** tinham regras adequadas de cancelamento apenas por PR, grupo exclusivo por `run_id` em outros eventos e/ou paralelismo aprovado. **Não modificados.**

Observação: esses são comportamentos demonstráveis da configuração e da semântica de `concurrency` do GitHub Actions; **não é uma medição de quantos minutos foram economizados nem prova de que um incidente específico tenha ocorrido**.

## 2. Alteração segura

Em cada um dos cinco arquivos, o grupo agora utiliza o padrão:

```yaml
concurrency:
  group: PREFIXO-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

O prefixo próprio de cada workflow foi preservado, sem compartilhar grupo entre workflows diferentes.

**Resultado por evento:**

| Evento | Grupo | Cancelamento | Finalidade |
| --- | --- | --- | --- |
| `pull_request` | `pr-N` no próprio workflow | `true` | Nova revisão da mesma PR substitui somente seus checks antigos; evita trabalho de CI do SHA obsoleto |
| `workflow_dispatch` | `run-ID` exclusivo | `false` | Execuções manuais independentes, mesmo na mesma ref, não se cancelam nem se substituem na fila |
| `push` (somente bots QA no ramo legado) | `run-ID` exclusivo | `false` | Preserva toda execução de push; nunca cancela revisão de PR ou manual |

### Arquivos modificados

1. `.github/workflows/android-bots-ui.yml` — cancelamento seletivo apenas de versões antigas da mesma PR; matrix de **três** suítes e `fail-fast: false` mantidos.
2. `.github/workflows/guardiao-v2-android-ui-ci.yml` — mesmo isolamento para a suíte GuardianV2 no emulador.
3. `.github/workflows/cloudflare-push-ci.yml` — mesmo isolamento para os testes offline do relay push.
4. `.github/workflows/ota-in-app-qa.yml` — remove serialização acidental de `workflow_dispatch` sem alterar cancelamento seletivo de PR.
5. `.github/workflows/ota-upgrade-qa.yml` — corrige o cancelamento **indevido de execuções manuais**.
6. `scripts/test_ci_optimization_contract.py` — regressão estática cobrindo os cinco padrões, os gatilhos, a matriz Android e a presença dos checks principais.

**Nenhum `on`/trigger, job, passo de build, credencial, permissão, cache, timeout, política OTA, contrato de CodeQL, ruleset ou mecanismo de deploy foi alterado.**

## 3. Riscos, validação e rollback

- **Trade-off consciente:** um commit novo numa PR pode interromper uma execução de emulador da mesma PR antes da conclusão e, portanto, a evidência daquele commit anterior pode ficar incompleta. A **revisão mais recente** continua elegível a rodar todos os seus testes. Nenhuma suíte foi reduzida nem substituída por mock.
- A saída do workflow de proteção contra exclusões (`pull_request_target`) não foi alterada; o check obrigatório segue sob seus próprios controles. Também não foram alterados os gatilhos dos workflows de diagnóstico nem a autocorreção arquivada.
- Testar `python3 -m unittest scripts.test_ci_optimization_contract scripts.test_qa_android_groups -v` no commit da PR, além dos checks obrigatórios e CodeQL.
- Conferir em Actions, após eventual integração autorizada, se duas execuções manuais distintas na mesma branch coexistem sem cancelamento e se um novo commit **na mesma PR** cancela apenas os runs obsoletos dos workflows em questão. Não criar manualmente execuções pesadas apenas para gerar estatísticas.
- Comparar métricas reais com `ci-latency-audit.yml` (somente leitura) em janelas semelhantes: tempo até os checks atuais ficarem verdes, esperas, runs cancelados e runners usados. A nota **10/10 não está provada por testes estruturais nem por apenas um run verde**.
- Em caso de regressão concreta, restaurar o `concurrency` anterior dos cinco workflows em outra PR (sem force push ou alteração de backups).

## 4. Governança

Esta entrega fica em **branch e PR draft até autorização expressa para merge**; não modifica `main`, backups, Firebase, Cloudflare, dados reais, bots ou custos. É uma melhoria pontual, não a reabertura indiscriminada de todas as otimizações encerradas na meta histórica de 9,0.
