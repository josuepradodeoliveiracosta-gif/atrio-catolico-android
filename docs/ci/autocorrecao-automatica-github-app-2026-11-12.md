# Autocorreção Inteligente — fluxo automático por GitHub App

**Estado:** implementação em revisão na PR #260. **Não está ativa em `main`.**
Não se deve considerar a automação concluída antes de configurar o GitHub App,
integrar o workflow mediante aprovação e observar uma execução real elegível.

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
4. Gere **uma chave privada da GitHub App**, mas não a envie ao chat,
   não a adicione a commits/PRs nem a arquivos públicos. No repositório,
   em **Settings > Secrets and variables > Actions**:
   - Cadastre `ATRIO_AUTOFIX_APP_CLIENT_ID` em **Variables**, com o
     *Client ID* público da App.
   - Cadastre `ATRIO_AUTOFIX_APP_PRIVATE_KEY` em **Secrets**, com
     o conteúdo privado da chave da App.
   - Não conceda essa chave a fluxos de PR: apenas o job privilegiado
     do novo workflow deve acessá-la.
5. Revise a PR #260 e seus checks. **A integração na `main` exige
   autorização expressa separada.** Depois da integração, o workflow
   recebe eventos CodeQL de `push` na `main` automaticamente.

A ação `actions/create-github-app-token@v3` restringe o token de
instalação **a este único repositório e às duas permissões listadas** e
revoga automaticamente o token ao finalizar o job. A chave privada
continua exigindo armazenamento seguro e rotação conforme a política
de segurança do projeto. `GITHUB_TOKEN` permanece somente leitura.

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
