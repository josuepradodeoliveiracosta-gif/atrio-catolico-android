# Autocorreção inteligente — etapa inicial de políticas (meta 99%)

Data: 12/11/2026. Integração proposta **somente na branch QA**; base:
commit de main aa30f8b10a425e9ffab8f105004b885d2551eced.

## Princípio e medição honesta

- **Meta de longo prazo:** automatizar **99% dos procedimentos elegíveis e seguros**, desde a detecção até a preparação de uma PR com testes.
- **Não é uma métrica alcançada:** neste primeiro incremento, o percentual real ainda é desconhecido e o JSON registra null. Os eventos de aprovação humana e procedimentos críticos nunca são removidos do denominador para inflar um resultado.
- Medição futura exige registrar, por janela de tempo, procedimentos elegíveis, procedimentos realizados sem intervenção, procedimentos bloqueados e reversões. Só anunciar uma taxa real após auditoria independente do denominador.
- Decisões críticas podem superar 1% das situações: a proteção da main, dados de pessoas, serviços de produção e custos prevalece sobre a meta numérica.

## Reaproveitamento do sistema existente

Não criar outro diagnóstico. Reutilizar a cadeia já integrada à main:

1. ci_quality_report.py — checks por SHA.
2. ci_diagnostic_snapshot.py — síntese e fila de jobs.
3. ci_log_identity_verifier.py — verificação de run/job/SHA.
4. ci_log_safe_analysis.py — IDs de sinais fixos, sem logs brutos.
5. **ci_autofix_policy.py (novo incremento)** — valida novamente a ligação entre os JSONs e propõe rotas de investigação QA, sem executar comandos.

O workflow ci-quality-report.yml mantém os eventos workflow_run e workflow_dispatch, os jobs e as mesmas permissões contents/checks/actions: read. Somente acrescenta uma chamada offline ao planejador e o artefato ci-remediation-plan.json; o Markdown existente recebe uma seção de propostas, não logs. A suíte de QA existente selos-ci.yml passa a testar esse contrato.

## Matriz de decisão conservadora — fase 1

| Caso | Decisão de plano | Limite |
| --- | --- | --- |
| Falha de ADB offline isolada | qa_emulator_health_review | Preparar revisão de saúde de emulador QA, sem reexecutar job |
| SQLite fechado isolado | qa_sqlite_lifecycle_review | Propor revisão de ciclo de vida em fixture QA |
| Assertion de fixture Rules QA | qa_rules_fixture_review | Investigar cópia offline; sem editar Rules de produção |
| Contrato de mock SHA QA | qa_mock_contract_review | Investigar mock/fixture, sem contato com Firebase real |
| Qualquer outro sinal, inclusive Kotlin, segurança e OTA | human_review | Não tentar correção genérica |
| Dois ou mais sinais, ou nenhum sinal | human_review | Causa ambígua ou não inferida |
| Checks obrigatórios incompletos/ausentes | blocked | Não confundir ausência por evento com falha verdadeira |
| Job sem identidade verificada, log indisponível ou resultados inconsistentes | no_action ou erro de validação | Nenhuma tentativa de conserto |

**Todas as rotas nesta etapa são somente propostas.** Não há execução de scripts de reparação, alterações em arquivos, push, abertura automática de PR, reexecução de workflow, merge, deploy ou alteração de secrets. O módulo não contém cliente HTTP, token, subprocess ou shell. IDs e mensagens são constantes; informações sensíveis dos logs não são serializadas.

## Segurança e critérios de aceitação

- SHA/repositório/job/veredito precisam corresponder à prova de identidade anterior.
- Exigir explicitamente limites de jobs e bytes, flags de não exposição de logs, ausência de ações de escrita e classificação compatível com número de sinais.
- Rejeitar IDs inesperados, duplicados, casos de identidade forjada e discrepâncias nas contagens.
- A falta de checks obrigatórios bloqueia até a elaboração de uma proposta QA elegível, sem afirmar incidente real.
- Testes offline cobrem aprovação apenas de propostas, rejeição de adulterações, isolamento dos dados sensíveis, CLI e repetição de relatório.
- **Sem alteração direta na main**, backup, produção, Firestore, Cloudflare, publicação de APK ou custo pago.

## Próximas etapas (fora deste incremento)

1. Implementar um executor **em sandbox** de patches mínimos de baixo risco, com arquivos autorizados por allowlist, hash de fonte conhecido, limites de diff, testes isolados, idempotência e rollback explícito.
2. Criar **PR draft** por integração com GitHub com permissões minimizadas e controle de duplicações, sem merge automático.
3. Aprovação humana para mudanças críticas; homologação com falhas reais auditáveis; métricas verdadeiras de automação, segurança e falsos positivos.

Não declarar a meta 99% alcançada antes dessas etapas e de medição verificável.


## Etapa 3 — piloto de alteração efetiva e descartável na sandbox

O primeiro experimento de correção **altera realmente o conteúdo de uma fixture sintética SQLite dentro de um TemporaryDirectory** e confirma o novo SHA-256 e a sintaxe Python antes de destruir o diretório. Uma conexão fechada antes de \`execute("SELECT 1")\` é substituída por uma leitura antes de \`close()\`, mantendo o resultado em variável local.

**Este piloto NÃO corrige um arquivo real do aplicativo ou do repositório.** Seu propósito é provar a separação entre propor, executar isoladamente e autorizar a promoção de um patch. O sistema apenas poderá produzir o patch da fixture interna, byte a byte fixado; modificações na entrada, hashes inesperados e execuções repetidas sobre conteúdo já corrigido são recusadas.

O piloto é deliberadamente elegível **apenas quando** o plano verificado tiver um único job, com um único sinal \`sqlite_closed_database\`, receita \`qa_sqlite_lifecycle_review\`, gates obrigatórios completos e indicadores explícitos de que nenhuma ação remota foi executada. Nenhuma outra classe permite execução.

O workflow de relatório já existente agora chama \`scripts.ci_autofix_sandbox\` **após** o planejamento, permanecendo somente leitura perante o GitHub. Seu novo JSON \`ci-autofix-preview.json\` publica apenas o patch da fixture estática ou o estado bloqueado, sem conter texto original de logs. Nenhum fluxo, job, permissão, secret ou serviço extra foi adicionado; é o **sétimo artefato** quando a PR for autorizada para integração.

O gate atual de testes passa a executar \`scripts.test_ci_autofix_sandbox\` juntamente aos contratos anteriores. Ficam bloqueados desvio de caminho, edição de arquivos reais, repetição do patch, sinais múltiplos, identidade não verificada, ausência de checks e ações remotas.

### Saída esperada e limites restantes

- A execução em sandbox pode produzir \`sandbox_patch_verified\` ou \`blocked_not_eligible\`.
- \`repository_files_changed = 0\`, \`automatic_pull_requests_created = 0\`, \`automatic_merges_or_deploys = 0\`.
- Nenhum script de reparação foi autorizado a modificar o repositório GitHub, ainda que a correção sintética tenha passado.
- **Não confundir este piloto com autocorreção operacional**: ainda faltam patches em arquivos QA reais com allowlist, testes de regressão completos, geração de PR draft automatizada e revisão humana de promoção.
- A meta de 99% continua sendo apenas objetivo, sem taxa medida.
