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


## Etapa 3.1 — fixture versionada de QA, allowlist e hash

O piloto foi ampliado, sem gerar um segundo sistema e sem alterar a politica de permissoes.

- O arquivo \`tests/qa/autofix/sqlite_closed_connection.py\` passou a existir **no checkout da branch de QA** como fixture de treinamento deliberadamente falha (a conexao e encerrada antes da consulta). **Nao e codigo executado pelo app**.
- \`scripts.ci_autofix_sandbox\` recebe \`--checkout-root .\` no workflow de relatorio. Le exclusivamente esse caminho fixo, listado em \`QA_PATH_ALLOWLIST\`, e confere limite de bytes, SHA-256 e igualdade exata com a fonte aprovada. Rejeita symlink em qualquer segmento da rota, desvio de caminho, fixture ausente ou alterada.
- O mecanismo prepara um **diff real desse arquivo de QA versionado**, mas aplica a correcao **somente em uma copia dentro de TemporaryDirectory**. O checkout original permanece intacto; nenhuma PR automatica, commit, push, merge, rerun ou deploy e executado.
- \`ci-autofix-preview.json\` informa \`checkout_fixture_verified\` para distinguir o teste com fixture embarcada do teste com origem no repositorio. Nao inclui logs brutos nem caminhos arbitrarios.
- Novos testes conferem hash e preservacao do arquivo versionado, alteracao de bytes, excesso de tamanho, ausencia do arquivo, symlink de arquivo/diretorio, tentativa de escapar da allowlist, planos bloqueados e chamada CLI usando o checkout.
- A meta **99%** segue **nao medida**. Esta extensao prova leitura e planejamento de reparos para um arquivo real de QA, **nao** autocorrecao operacional de erros arbitrarios do app.

A proxima promocao, se autorizada, exigira politica para arquivos de QA reais nao artificiais, aprovacao por diff e teste de regressao; jamais executar uma alteracao direta em producao.


## Etapa 3.2 — patch revisado em arquivo QA nao artificial (preview manual)

- Problema real observado no diagnostico de push para a `main`: o relatorio lista checks que so executam em Pull Requests como `missing`. A ausencia por evento precisa ser explicitada sem convertê-la em `success`.
- O adaptador `scripts/ci_autofix_qa_review.py` reutiliza a leitura por caminho/hash e a sandbox do modulo existente. O alvo **unico e fixo** e `scripts/ci_quality_report.py` (fonte real do CI, nao fixture artificial), com SHA-256 preaprovado. A lista de alteracoes (sete trechos) e estatica, revisavel e nao aceita log, comando, URL ou texto gerado por IA.
- O patch proposto adiciona `source_event` (`unknown`, `push`, `pull_request`) e `missing_pr_only_checks_on_push` ao JSON/Markdown. **Nao altera** `required_checks` nem `all_required_success`, nem remove gates; torna o contexto da ausencia auditavel.
- O codigo real e lido somente para analise. A copia e alterada e **revertida no `TemporaryDirectory`** antes de sua eliminacao; SHA-256 de rollback e verificado. Nenhum arquivo versionado e modificado pelo executor.
- `scripts/test_ci_autofix_qa_review.py` valida os sete trechos, reproducibilidade do diff, nao alteracao do checkout, sinalizacao correta em push/PR, tratamento de falhas reais como falhas, SHA invalido, arquivo adulterado, symlink/caminho estranho e CLI manual. O gate de QA e o workflow atual de diagnostico passam a executar os testes, sem adicionar permissao de escrita.
- **Promocao ainda NAO realizada:** a correção permanece somente no diff de uma sandbox; nao foi aplicada ao proprio `ci_quality_report.py`. O preview e **manual** e nao nasce automaticamente de um sinal validado. O workflow em producao continua informativo e nao abre PR nem reexecuta jobs.
- Criterio para proximo incremento: automacao de proposta somente quando o evento/prova de falha estiver verificado, mantendo o controle humano para writes/merges; assegurar idempotencia, dados de auditoria e testes de regressao antes de qualquer promocao.

A meta 99% continua sendo objetivo de autonomia futura e permanece sem percentual real mensurado.


## Etapa 3.3 — handoff com evidencia para futura PR draft

O modulo `scripts/ci_autofix_handoff.py` **reutiliza o pipeline existente**, em vez de rodar um segundo agente. Ele correlaciona `ci-report.json`, `ci-diagnostics.json`, `ci-remediation-plan.json`, o evento `workflow_run` e o patch revisado em sandbox. O oitavo artefato sera `ci-autofix-handoff.json` se a PR #260 for integrada apos autorizacao.

**Portao fechado por padrao:** so gera `draft_pr_intent_review_required` quando o evento comprovado e `push` na branch `main`, todos os SHA/repo concordam, os checks observados terminaram com sucesso, os dois checks gerais obrigatorios passaram, exatamente os tres checks PR-only estao ausentes, o relatorio nao tem outra falha, e o plano nao tem outras correcoes candidatas. Essa evidencia aponta **metadados de escopo**, nao comprova causa raiz.

O handoff executa exclusivamente o `preview_real_qa_patch` existente em copia temporaria; conserva allowlist/hash, rollback e diff estatico. Saidas nao contem logs, tokens, comandos, patch gerado por IA ou direitos de escrita. O `draft_pr_intent_id` e deterministico por commit para futura deduplicacao, **mas nao significa que uma PR foi criada**. Um evento desconhecido, `pull_request`, branch que nao seja main, check falho, sinal concorrente, dado adulterado ou SHA inconsistente bloqueia a proposta.

O workflow de relatorio continua com `contents/checks/actions: read`. A nova chamada produz apenas JSON informativo, nao altera repositorio e nao usa API adicional; os testes de `scripts/test_ci_autofix_handoff.py` rodam no gate de QA e no relatorio existente.

**Proximos requisitos antes de qualquer PR automatica real:** vincular o plano a prova independente de HEAD atual, validar diff/testes por SHA e definir chave de deduplicacao, lista de permissoes minimas, limites por evento, rollback e revisao humana. Nao transformar esta etapa em permissao implicita de merge, deploy, publicacao ou servicos pagos.

**99% continua sendo meta de automacao**, nao medicao atual. A funcionalidade de agora e uma **proposta preparada para revisao**, nao uma correcao aplicada.


## Etapa 5 (piloto) — descritor de PR draft, deduplicação e HEAD atual

O módulo `scripts/ci_autofix_pr_draft_plan.py` foi acrescentado **sobre o handoff existente**, não como motor separado. Sua única finalidade é preparar um descritor de PR em modo somente leitura, sem criar branch, commit ou Pull Request.

- Se o handoff estiver bloqueado, retorna `blocked_by_handoff` **sem consultar APIs adicionais**. Só um `draft_pr_intent_review_required` com SHA/hash de patch e flags de não escrita verificáveis é elegível.
- Um candidato é comprovado novamente em sandbox temporária, exigindo hash SHA-256 fixado da fonte, hash do patch e rollback.
- O planejador consulta, exclusivamente por HTTPS `api.github.com`, o SHA atual da `main` e a primeira página de PRs abertas, com limite máximo de **99 PRs**. Se houver 100, recusa por cobertura incompleta em vez de ignorar possíveis duplicações. Usa `NoRedirect`, limite de bytes e token restrito à API oficial.
- Se o SHA da `main` mudou, marca `blocked_stale_main_head`. Se já existe PR da mesma origem e branch `qa/autofix-ci-scope-main` para `main`, marca `blocked_existing_pr` com somente IDs numéricos. Não publica títulos, descrições ou URLs externos.
- Sem duplicação e com HEAD igual à evidência, produz `draft_pr_descriptor_ready_for_review`, contendo branch/base, título e corpo fixos e indicação expressa de que faltam testes no futuro commit da PR. **A saída continua `eligible_for_automatic_remote_write=false`, `draft_pr_created=false` e `remote_writes=0`.**
- Os workflows de CI existentes mantêm as mesmas permissões de leitura e executam `scripts.test_ci_autofix_pr_draft_plan`. O novo artefato `ci-autofix-pr-draft-plan.json` será o nono da cadeia quando houver integração autorizada.
- Meta de 99% é objetivo; **percentual real não medido**. Os testes cobrem evento/sinal forjado, SHA desatualizado, duplicação, limite de paginação, ausência de token, URL fixa e ausência de alteração da produção.

**Ainda pendente para criação efetiva automática de PR draft:** um executor em workflow separado de credenciais de escrita mínimas, limitado à branch/arquivo/diff permitidos, SHA compare-and-swap, proteção contra corrida entre leituras e escritas, validação completa do novo HEAD, teste de regressão na PR gerada e aprovação humana para merge. Nenhuma dessas ações foi ativada neste piloto.


## Etapa 5.2 — guarda de branch existente (inclusive sem PR aberta)

O preflight de PR draft passou a consultar, em modo **somente leitura**, tambem a ref fixa
`refs/heads/qa/autofix-ci-scope-main`. Se a branch ja existir, mesmo sem
uma PR aberta, a proposta e **bloqueada** com `blocked_existing_branch`.
Esse bloqueio protege mudancas anteriores de sobrescrita e evita assumir
que uma branch desocupada significa simplesmente "nenhuma PR aberta".

A consulta usa o host oficial do GitHub, URL fixa, `NoRedirect` e os limites
anteriores. **Somente HTTP 404** na ref fixa significa branch ausente;
HTTP 403, respostas malformadas, falha de rede e qualquer outro erro sao
tratados como impeditivos, jamais como permissao de escrita.

O artefato informa `target_branch_absence_checked` e, quando elegivel,
`race_window_remains=true`: a leitura **nao bloqueia concorrencia real**.
Portanto um futuro executor devera repetir as verificacoes de SHA/ref
**imediatamente antes da tentativa de criar a branch**, e usar
operacoes Git condicionais sem substituir uma ref existente.

Testes adicionais cobrem branch existente sem PR, branch inexistente por 404,
erro 403, ref inesperada e ausencia de informacao de branch no contexto.
O workflow mantem `contents/checks/actions: read`, sem ativar escritor,
sem nova PR automatica, sem merge e sem deploy.

**Regra permanente:** a meta de 99% nao substitui a autorizacao humana para
alteracoes criticas. O percentual real continua sem medicao.


## Etapa 5.3 — permissão mínima para consultar PRs sem escrita

A consulta autenticada de PRs abertas usa o endpoint `GET /pulls`, cuja
permissão fina de API é `pull-requests: read`. O workflow existente de
relatórios recebeu **exclusivamente essa permissão adicional de leitura**,
mantendo `contents: read`, `checks: read`, `actions: read`. Não há
`contents: write`, `pull-requests: write`, nem secrets novos.

Um teste de contrato verifica a declaração exata de permissões, a integração
do descritor read-only e a ausência de `: write` no workflow. Esse
acréscimo de leitura permite ao diagnóstico confirmar duplicidades sem
autorizar criação de branch, commit, PR, merge ou deploy.

Qualquer futura ativação de um executor com permissões de escrita exigirá
separação de credenciais/workflow, revisão específica e autorização antes de
modificar recursos remotos. A verificação de ausência de branch, mesmo
autenticada, não elimina condições de corrida; o escritor futuro terá de
realizar a checagem novamente com operação condicional.
