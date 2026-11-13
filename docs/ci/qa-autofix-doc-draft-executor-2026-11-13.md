# Executor QA de PR draft documental — homologação offline (Fase 2)

**Escopo:** preparatório, sem token, sem rede e sem qualquer escrita remota.
A receita documental de `scripts/ci_autofix_doc_candidate.py` foi
integrada pela PR #264, que manteve intocado o documento candidato
`docs/ci/autocorrecao-automatica-github-app-2026-11-12.md`.

## O que este marco implementa

- `scripts/ci_autofix_doc_draft_executor.py`: orquestra a mesma transação
  que futuramente poderá criar **uma PR em rascunho** de QA; aceita
  **exclusivamente** o tipo `InMemoryDraftClient`, sem adaptador HTTP,
  sem cli `--execute`, sem `GITHUB_TOKEN` ou secret de GitHub App.
- Nome da branch fixo `qa/autofix-doc-history-v1`. Nenhuma branch
  já existente ou PR duplicada pode ser substituída.
- Um único arquivo permitido, de origem fixada por hash Git blob
  `12f8eecb3c4cb203c60f8f2bfeaf0fd476873a95`; a única
  alteração permitida é `qa_document_integration_history_v1`.
  Origem, prévia e rollback em sandbox devem coincidir antes da
  primeira operação simulada.
- O simulador confere `main_sha`, inexistência de branch e PR,
  SHA e bytes do documento, resposta de criação da branch,
  novamente a `main`, conteúdo pré-escrita, hash do documento
  alterado, diff exato de um arquivo, ausência de duplicação e
  resposta de PR `state=open`, `draft=true`, sem merge.
- Erro ou desvio em qualquer estágio interrompe a transação.
  Falhas **depois** da criação de branch simulada não provocam
  exclusão, force push, retry ou compensação destrutiva.
- A saída informa `remote_writes=0` e
  `actual_pull_requests_created=0`. O contador de operações
  simuladas não é prova de escrita de verdade.
- `scripts/test_ci_autofix_doc_draft_executor.py` testa sucesso
  controlado e bloqueios de drift de `main`, conteúdo remoto,
  branch/PR preexistente, diff extra, PR não-draft e respostas
  divergentes. Integrado no check de contratos do Firestore/CI.

## Limites desta autorização

A função `simulate_approved_doc_draft` não aceita clientes
externos, só `InMemoryDraftClient`; não é conectada ao workflow
`.github/workflows/autofix-qa-approved-draft.yml`.
A GitHub App demonstrou autenticação e leitura (run `43441065755`),
**não demonstrou token write nem criação real de PR**. A receita
anterior da PR #261 já foi aplicada e segue bloqueada.

## Pré-requisitos futuros (Fase 3, aprovação separada)

1. Rever modelo de ameaças e contrato de API em branch própria,
   preservando o script original e a política de permissões.
2. Conectar um adaptador real **somente após** verificação de
   evento confiável, SHA da `main`, hash de documento, ausência
   de branch e PR duplicadas, e autorização expressa específica.
3. Receber token de App efêmero com Contents/Pull requests write
   somente no ambiente protegido `atrio-autofix-qa`;
   nunca expor chave, token, resposta HTTP ou dados sensíveis.
4. Exigir branch QA nova, update único de documentação,
   validação da árvore/diff e somente PR em rascunho;
   **nunca merge automático**, deploy, ação Firebase/Cloudflare,
   APK oficial, backup ou exclusão de dados.
5. Em falha parcial, parar sem force push nem reexecução cega,
   preservando evidência para revisão humana.

## Aceite desta Fase 2

- Testes offline verdes com simulação de falhas;
- CI obrigatória de Firestore/Android, CodeQL, segurança e versão;
- Nenhuma operação remota efetiva nem mudança da `main`;
- Aprovação humana distinta antes de integrar a PR preparatória;
- Homologação de escrita real somente após outra autorização.
