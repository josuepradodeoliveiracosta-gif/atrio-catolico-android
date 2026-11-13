# Fase 3A — contrato de API da GitHub App para PR documental (sem escrita)

**13/11/2026 — preparatório, NÃO homologação de escrita.**

A PR #264 fixou a candidata `qa_document_integration_history_v1`,
e a PR #265 integrou um simulador em memória que jamais escreve no GitHub.
O documento candidato continua com a instrução obsoleta da PR #260.

## O que foi adicionado

`scripts/ci_autofix_doc_github_adapter.py` prepara a camada de API
necessária à homologação, mas separa rigidamente:

- **Leituras autenticadas, sem escrita:** o `DocGitHubAppReader` aceita
  um token efêmero fornecido externamente, nunca consulta variáveis de
  ambiente e só envia GET ao host `api.github.com`, por rotas fixas.
  Nenhum HEAD de PR, log, artefato ou usuário altera as rotas.
- **Escopo da instalação:** `GET /installation/repositories?per_page=2`
  deve mostrar **exatamente um repositório autorizado**.
- **Estado remoto estável:** verifica `main` por SHA, a ausência
  da branch fixa `qa/autofix-doc-history-v1` e o histórico de PRs
  filtradas pela branch (abertas **ou encerradas**) sem entradas
  conflitantes ou paginação potencialmente incompleta. Apenas o GET
  da referência QA pode aceitar HTTP 404.
- **Origem documental idêntica:** GET do arquivo original na `main`,
  decodificação base64 limitada e confirmação de Git blob SHA
  `12f8eecb3c4cb203c60f8f2bfeaf0fd476873a95`, bytes,
  patch pré-aprovado, SHA-256 e rollback da sandbox. Faz nova
  leitura de estado antes de encerrar o preflight.
- **Controles HTTP:** redirecionamentos rejeitados, resposta
  limitada por bytes, timeout fixo e mensagens de erro sem
  imprimir token, corpo de resposta, HTML ou payload.
- **Planejamento de escrita, sem envio:** a função
  `draft_write_intents` emite **dados imutáveis por receita**:
  (1) criar uma branch nova QA, (2) alterar só o documento aprovado
  usando o hash do blob antigo, (3) propor PR `draft=true`,
  `maintainer_can_modify=false`. O planejador NÃO tem
  transportador POST/PUT/PATCH/DELETE.

## Limites explícitos e segurança operacional

- **Não há CLI nem caminho de execução real neste módulo.** O
  `DocGitHubAppReader` possui só GET; o planejador produz dados e
  não aceita uma função de envio. As chamadas deste PR nos testes
  utilizam apenas respostas HTTP falsas, em memória.
- Nenhuma alteração no workflow
  `.github/workflows/autofix-qa-approved-draft.yml`; o writer
  antigo, restrito à receita já aplicada da PR #261, permanece
  com as proteções que o tornam inelegível.
- Não há acesso a PEM, secrets, variáveis GitHub, Firebase,
  Cloudflare, backups, produção, APK oficial ou custos pagos.
- Para conectar um **adaptador real de escrita**, ainda será
  necessário outra PR, revisão independente das permissões e
  **autorização expressa e específica antes de qualquer transação
  remota**. A existência de request-intents não constitui essa
  autorização.
- Falhas e corridas após uma futura criação de branch devem
  bloquear a sequência, sem force-push, rerun cego ou exclusão
  destrutiva. Uma PR criada deve ficar em rascunho até revisão
  humana; nunca fazer merge ou deploy automático.

## Critérios de aceitação desta fase preparatória

1. Testar com transporte falso o sucesso da leitura e bloqueios:
   token inválido, outro repo, SHA antigo, branch existente,
   PR encerrada, paginação cheia, 403, resposta adulterada,
   arquivo/hash errado, resposta grande ou JSON inválido.
2. Validar que a fonte original não é modificada e que o
   planejador produz três intents fixas, sem rede.
3. Concluir CodeQL, Android, Firestore, segurança, versão e
   demais checks da PR e registrar o SHA exato.
4. Deixar a PR em revisão, sem integrar à `main` antes da
   autorização do proprietário. Homologação real de escrita
   permanece não iniciada.
