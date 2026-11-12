# Auditoria manual de uma PR QA existente — somente leitura

**Projeto:** Átrio Católico — piloto conservador de autocorreção, 12/11/2026.

**Escopo:** conferir uma PR de QA previamente autorizada; **não** criar branch, commit, PR, release, merge, deploy, alterar `main`, produção, backups, Firebase ou Cloudflare. O comando descrito aqui está apenas na PR #260, que precisa continuar em *draft* até revisão humana.

## Evidências fixadas

- Repositório: `josuepradodeoliveiracosta-gif/atrio-catolico-android`.
- PR autorizada já existente: [#261](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/261), branch `qa/autofix-ci-scope-main`.
- SHA da base `main`: `aa30f8b10a425e9ffab8f105004b885d2551eced`.
- SHA do commit QA: `f0f9085b0a6816dc26b93e21c446d732d7128c4a`.
- Único arquivo modificado na PR #261: `scripts/ci_quality_report.py`.
- A verificação deve **falhar** se os SHAs, a base, a branch, o patch estático, a origem, o estado `draft`, a ausência de merge ou a unicidade da PR se alterarem. Não se considera um erro HTTP 403 ou uma resposta inválida como permissão para escrita.

## Separação de credenciais

A implementação usa `GitHubDraftReader`, uma classe que só possui consultas GET. A CLI `scripts/ci_autofix_draft_readonly_audit.py` aceita credencial **somente** pela variável de ambiente `ATRIO_QA_READ_TOKEN`. Não aceita token por argumento, não reutiliza `GITHUB_TOKEN` de Actions e bloqueia `GITHUB_ACTIONS=true`. A saída em JSON não contém o token e inclui `credential_scope_independently_verified=false`.

Recomenda-se **credencial separada, fine-grained, selecionando somente esse repositório, com permissões de leitura de Contents e Pull requests**. Metadados são exigidos implicitamente pelo GitHub. O comando **não consegue verificar independentemente as permissões concedidas à credencial**: sua segurança de operação vem dos endpoints GET do código, não de uma alegação de escopo comprovado. Jamais inserir token em chat, comentário, workflow, repositório, captura de tela ou URL.

Para homologar **o executor de escrita**, ainda são necessárias uma credencial **diferente**, minimamente privilegiada (Contents:write e Pull requests:write), avaliação humana dos escopos/ambiente e aprovação específica para qualquer nova operação. **Não incluir esta credencial de escrita em workflows de PR ou de relatório.** A criação manual da PR #261 via conector não comprovou que o executor Python funciona com esse token.

## Configuração segregada de credenciais no celular (fase 1)

**Primeiro criar somente a credencial de leitura**, no navegador do Android,
na própria conta GitHub do proprietário. URL oficial com parte das opções
pré-preenchidas (conferir tudo antes de gerar):

[Gerar token fine-grained Atrio-QA-Readonly](https://github.com/settings/personal-access-tokens/new?name=Atrio-QA-Readonly&target_name=josuepradodeoliveiracosta-gif&expires_in=30&contents=read&pull_requests=read)

1. Acessar `Settings > Developer settings > Personal access tokens > Fine-grained tokens`.
2. Definir nome `Atrio-QA-Readonly` e expiração de **30 dias** (sem prazo infinito).
3. Em **Resource owner**, selecionar `josuepradodeoliveiracosta-gif`.
4. Em **Repository access**, escolher **Only select repositories** e
   selecionar **somente** `atrio-catolico-android`.
   O link de criação **não comprova essa seleção**: confirmar visualmente.
5. Em **Repository permissions**, definir **Contents: Read-only** e
   **Pull requests: Read-only**; deixar **Metadata: Read-only** (padrão)
   e as demais permissões sem acesso. Em especial, **não conceder**
   `Contents: Write`, `Pull requests: Write`, `Administration`,
   `Actions`, `Secrets` nem `Workflows`.
6. Antes de confirmar, revisar nome, validade, proprietário, lista de
   repositórios e todas as permissões. Gerar e manter a credencial fora
   do chat, da PR, de commits e de capturas de tela.

**Verificação manual de escopo:** a tela de detalhes do token no GitHub deve
mostrar o único repositório selecionado e as duas permissões de leitura.
Essa verificação humana é diferente da auditoria GET-only executada pelo
script: uma consulta bem-sucedida ao GitHub **não** prova que o token careça
de escrita.

**Segunda credencial, separada, só em outra etapa explicitamente autorizada:**
para o executor *writer*, planejar `Contents: Read and write` e
`Pull requests: Read and write` exclusivamente no mesmo repositório,
sem administração, Actions ou acesso à produção. Não aumentar os poderes
do token de leitura, não reutilizá-lo como escritor e não ativar o
`GitHubDraftClient` em CI. Antes de um teste real do escritor, conferir
as permissões na interface do GitHub, a expiração, o ambiente segregado
e o escopo preciso da operação.

**Fontes oficiais:**
[GitHub — managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens);
[GitHub — fine-grained token permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens);
[GitHub — create pull request permissions](https://docs.github.com/en/rest/pulls/pulls).

## Exemplo no Termux (Android)

Na cópia local da **branch da PR #260**, após atualizar o checkout e verificar sua origem/HEAD:

```bash
set +x
read -r -s -p 'Token GitHub somente leitura: ' ATRIO_QA_READ_TOKEN
echo
export ATRIO_QA_READ_TOKEN

python3 -m scripts.ci_autofix_draft_readonly_audit \
  --checkout-root . \
  --base-sha aa30f8b10a425e9ffab8f105004b885d2551eced \
  --head-sha f0f9085b0a6816dc26b93e21c446d732d7128c4a \
  --pr-number 261

unset ATRIO_QA_READ_TOKEN
```

A saída esperada em caso de sucesso tem `status=existing_qa_draft_verified_read_only`, `remote_writes=0`, `writer_executed=false` e `credential_scope_independently_verified=false`. Ela **não** é aprovação para merge. Em falha, a CLI devolve código 2, mensagem genérica sem token e não tenta corrigir nem repetir operações remotas.

## Critérios para encerrar a etapa de automação real

1. Comprovar o isolamento da credencial de escrita, suas permissões efetivas, o ambiente e os controles de revogação, sem expor segredos.
2. Não reutilizar a branch/PR #261 para outra escrita: ela já existe. A CLI de auditoria acima deve apenas **reconciliar o estado**, nunca chamar `execute_manually_approved_draft`.
3. Para um novo cenário de escrita, exigir autorização de escopo específico, receita pinada, branch nova não conflitante, revisão de segurança, tratamento de falhas parciais e checks do commit exato. Não criar PRs duplicadas.
4. Manter `main`, backups, produção e integrações externas sem mudanças, salvo autorização explícita e separada.
5. Medir a taxa real de automação antes de fazer qualquer afirmação sobre a meta de 99%.

**Estado:** a auditoria GET-only está implementada e testada em ambiente simulado; sua execução com credencial real segregada ainda precisa ser comprovada. Os resultados de CI do commit exato devem ser registrados antes de declarar esta mudança homologada.
