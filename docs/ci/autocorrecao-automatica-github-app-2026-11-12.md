# Autocorreção Inteligente — fluxo automático por GitHub App

**Estado em 13/11/2026:** PRs #260 e #262 integradas na `main`. O diagnóstico
seguro e o bloqueio de escrita inelegível foram validados em execuções reais;
**a emissão do token GitHub App e a criação de PR elegível continuam não
comprovadas**. As seções sobre integração das PRs #260/#261 abaixo registram
a sequência histórica, não instruções pendentes.

## Ordem obrigatória de integração (revisão de 12/11/2026)

**Não fazer merge automático.** Os checks verdes de cada PR isolada não
validam sozinhos a composição dos dois conjuntos de alterações.

1. Revisar a **PR #261 primeiro**, pois ela adiciona ao relator de CI
   a opção `--source-event` (mantendo `unknown` como padrão).
   Esta PR modifica apenas `scripts/ci_quality_report.py`. Exigir
   aprovação humana e checks atuais antes de integrar.
2. Revalidar **PR #260 contra a `main` já contendo #261**:
   os workflows desta PR passam agora `--source-event` ao relator.
   Essa CLI não existe antes de #261, portanto **integrar #260 primeiro
   quebraria os jobs de relatório**. Os testes históricos da receita
   em #260 preservam a versão original em sandbox e testam o estado
   real `already_applied` sem criar segunda PR.
3. Verificar CI completa no SHA ou merge-result correspondente à
   **combinação**. Se a proteção de branch exigir atualização,
   tratar a atualização em branch de revisão, preservando trabalho
   alheio. Não declarar a combinação validada apenas por 6/6 de cada
   HEAD independente.
4. Somente após autorização expressa, integrar #260 e observar o
   diagnóstico no primeiro evento seguro `main/push`. O job escritor
   deve permanecer inelegível quando a correção já existir; não
   forçar nova correção para testar a chave privada. Uma prova de
   token de instalação sem escrita pode ser planejada separadamente
   para a etapa de validação real.

**A GitHub App e a proteção do ambiente foram configuradas pelo
proprietário**; o segredo foi informado como cadastrado. Os valores
não são acessíveis ao assistente nem devem ser publicados. A execução
real do token e dos novos workflows continua não verificada.

## Comportamento esperado após aprovação e integração

1. O workflow CodeQL termina com sucesso para um `push` legítimo na
   `main` do próprio repositório Átrio Católico.
2. `.github/workflows/autofix-qa-approved-draft.yml` inicia um **job de
   diagnóstico somente leitura**: checkout da `main`, validação da origem
   do evento e do SHA, classificação, análise de sinais, teste em sandbox,
   handoff e descritor de PR usando os módulos de QA existentes.
3. Se e somente se a receita **estática já revisada** for elegível, o
   segundo job baixa somente JSONs do job anterior, revalida origem,
   manifesto e estado atual do GitHub, obtém um **token efêmero de GitHub
   App com Contents:write e Pull requests:write** restrito ao repositório
   `atrio-catolico-android`, e executa a transação de PR draft.
4. O executor cria **somente** a branch fixa de QA e um patch de arquivo
   fixado por SHA-256; confirma bytes, diff, base/head e uma única PR draft.
   **Nunca executa merge, exclusão de branch, release, deploy ou escrita em
   Firebase, Cloudflare, produção e backups.** Falhas parciais ficam para
   inspeção humana, sem retry destrutivo.
5. A PR criada pela App dispara os workflows de CI da PR. O merge
   da `main` permanece sujeito às regras do repositório e revisão humana.

**Não existe autonomia irrestrita:** só são candidatas correções com receita
pré-aprovada e origem verificada. Os sinais não provam automaticamente causa
raiz; sem evidência completa, não há escrita.

## Configuração inicial única pelo proprietário (Android/navegador)

Não use o PAT de leitura ou o PAT pessoal de escrita para esse workflow.
O primeiro já foi exposto nesta conversa e deve ser revogado/rotacionado;
o segundo, caso seja gerado, não precisa ser instalado na automação.

1. Em **GitHub Settings > Developer settings > GitHub Apps**, crie uma
   GitHub App dedicada, por exemplo `atrio-qa-autofix`. Desative o webhook
   se não houver endpoint próprio; **não solicite permissões de organização
   nem de conta**.
2. Em **Repository permissions** da App, conceda apenas
   **Contents: Read and write**, **Pull requests: Read and write** e
   **Metadata: Read-only** (obrigatório). Sem Actions, Administration,
   Secrets, Deployments, Checks-write ou Workflows.
3. Instale a App na conta
   `josuepradodeoliveiracosta-gif` usando **Only select repositories**,
   escolhendo exclusivamente `atrio-catolico-android`.
4. Em **Settings > Environments**, crie o ambiente
   `atrio-autofix-qa`; em **Deployment branches and tags** selecione
   **Selected branches and tags** e permita **somente a branch `main`**,
   nunca PRs, branches de feature ou curingas. Não configure
   *required reviewers* nesse ambiente, pois o gate automático usa políticas
   de código e a revisão humana ocorre somente antes do merge da PR.
   O job declara `deployment: false`, então não cria um deploy.
5. Gere **uma chave privada da GitHub App**, mas não a envie ao chat,
   não a adicione a commits/PRs nem a arquivos públicos. Guarde-a
   **somente no Secret do ambiente `atrio-autofix-qa`**,
   com o nome `ATRIO_AUTOFIX_APP_PRIVATE_KEY`.
   Em **Environment variables** do próprio ambiente
   `atrio-autofix-qa` (ou nas variáveis de Actions do repositório),
   armazene apenas o `ATRIO_AUTOFIX_APP_CLIENT_ID` público, usando
   o *Client ID* da App. O job `write_draft` referencia o ambiente
   e consegue acessar essa variável pelo contexto `vars`. Não coloque a chave em secrets do repositório:
   assim apenas jobs que referenciem o ambiente aprovado podem recebê-la.
   Nunca conceda esse segredo aos workflows de PR.
6. **Depois das integrações autorizadas das PRs #260 e #262**, confira
   no GitHub Actions o diagnóstico automático da `main` e seu bloqueio
   quando não houver receita elegível. Não reaplique o patch da PR #261.

A ação `actions/create-github-app-token@v3` restringe o token de
instalação **a este único repositório e às duas permissões listadas** e
revoga automaticamente o token ao finalizar o job. A chave privada
continua exigindo armazenamento seguro e rotação conforme a política
de segurança do projeto. `GITHUB_TOKEN` permanece somente leitura.

## Validação real após integração (#260, 13/11/2026 UTC)

O primeiro `push` da `main` após integrar #260, SHA
`20a2f8d0102ac061d98803acc54c0aece94315b0`, passou no CodeQL e
disparou a automação (Actions run `43350631511`) e o relatório consolidado
(run `43350631545`). Ambos falharam na etapa de handoff, antes de
qualquer escrita, com `ValueError: checks invalidos ou duplicados`.

A API do GitHub pode retornar múltiplos *check runs* com o mesmo nome no
mesmo SHA. A proteção original rejeitava duplicatas levantando exceção,
derrubando também relatórios legítimos. A correção em revisão mantém
todas as linhas e valida a coerência do relatório, do diagnóstico e do plano;
quando há nomes repetidos, conclui como
`blocked_competing_failure_or_log_evidence`, com motivo
`repeated_check_names_need_manual_review`. **Nunca gera elegibilidade,
PR, token de escrita ou merge.** Entradas malformadas, SHAs incompatíveis
e resultados obrigatórios adulterados continuam gerando erro.

**A prova completa de comportamento real só estará concluída quando
uma execução posterior do workflow confirmar esse bloqueio em runtime.**
Também não se testou o token da App nem a criação automática de PR elegível.

## Limites da homologação atual

- A PR #261 já possui a branch estática
  `qa/autofix-ci-scope-main` e o patch aprovado.
  Portanto o novo workflow, se executado nesse estado, deve concluir
  o diagnóstico sem iniciar o job escritor: **não há uma segunda PR
  legítima a ser criada para a mesma receita**.
- A receita `ci_push_pr_only_check_scope_metadata_v1` cobre apenas
  uma situação de metadados de checks de CI. Para outras falhas,
  adicionar receitas estáticas independentes, testes e revisão antes
  de habilitá-las. Não gerar comandos ou código a partir de logs.
- Não configurar `pull_request_target` nem executar checkout de
  cabeçalhos de PR em jobs privilegiados.
- A porcentagem de 99% continua **meta não medida**, não uma
  capacidade do sistema já demonstrada.

## Critérios mínimos de aceitação

- Os testes `scripts.test_ci_autofix_automatic_gate` e
  `scripts.test_ci_autofix_pr_draft_executor` devem passar no
  SHA exato, juntamente com Firestore, build Android, CodeQL e
  demais checks obrigatórios da PR.
- Para evento de PR, fork, branch alheia, CodeQL com falha, SHA antigo,
  PR/branch duplicada, source/patch fora do hash ou arquivo extra:
  **zero escritas**.
- O job de diagnóstico não recebe segredos e o token da App só é criado
  depois que a elegibilidade foi confirmada.
- O job escritor usa apenas código da `main` confiável, nunca extrai
  executáveis de artefatos e nunca faz merge.
- A operação real ainda depende de um cenário elegível novo, com
  evidências da PR draft, checks e revisão.

## Documentação oficial

- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- https://github.com/actions/create-github-app-token
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app


## Prova manual do token da GitHub App — somente leitura

A etapa final depende da emissão real de um token temporário a partir
do Client ID e do secret do ambiente protegido `atrio-autofix-qa`.
A ação `actions/create-github-app-token@v3` aceita `client-id`
e autoriza reduzir as permissões de um token da instalação para
`permission-contents: read` e `permission-pull-requests: read`.
O token é automaticamente revogado no fim do job.

A PR de homologação adiciona o workflow
`.github/workflows/qa-autofix-app-token-smoke.yml`, com as seguintes
restrições auditáveis:

- Apenas `workflow_dispatch` manual do usuário proprietário na `main`
  protegida, nunca `pull_request`, `push`, `workflow_run` ou agendamento.
- Usa somente o ambiente `atrio-autofix-qa`, sem registro de deployment,
  com `GITHUB_TOKEN` limitado a Contents read e checkout sem credenciais.
- Testes offline devem passar **antes** da ação que acessa o secret.
- O token da App recebe **somente leitura**, escopo limitado a
  `josuepradodeoliveiracosta-gif/atrio-catolico-android`.
- O script executa exclusivamente três requisições HTTPS **GET** com URL
  fixa: `/installation/repositories?per_page=2`, leitura de um único
  arquivo de workflow da `main` e lista de PRs com `per_page=1`.
  Redirecionamentos são proibidos e respostas têm limite de tamanho.
- Confirma que apenas **um repositório** está listado no token da
  instalação e que as duas leituras funcionam. Não imprime token,
  resposta HTTP, dados de instalação ou valor de secret.
- Nenhuma criação de PR, push, commit, modificação de arquivo remoto,
  release, rerun, deploy ou acesso a serviços de produção.

**Procedimento no Android:** somente depois de aprovação explícita e
merge dessa PR de homologação, entrar em GitHub > repositório >
Actions > **QA - Verificar token GitHub App (somente leitura)** >
**Run workflow**, selecionar `main` e confirmar. Consultar apenas
o resultado `success`/falha e o log de sucesso de texto fixo.
Nunca copiar o PEM nem o token para a conversa.

**Critérios da validação real:** job deve terminar com sucesso,
token temporário emitido pela App configurada, escopo do repositório
e endpoints de leitura comprovados; nenhuma escrita nem segredo
publicado. Isso **não comprova** por si só a criação de PRs draft pelo
job escritor original, que ainda depende de um cenário QA realmente
elegível e autorizado, sem reaplicar a correção já integrada.

Fontes da ação: https://github.com/actions/create-github-app-token
e https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
