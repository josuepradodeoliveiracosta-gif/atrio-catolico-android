# Fase 3B — transação de escrita QA da GitHub App (NÃO EXECUTADA)

**13 de novembro de 2026.** A receita documental da PR #264, o
simulador da PR #265 e o adaptador HTTP GET da PR #266 já estão integrados.
O documento original que contém a instrução desatualizada permanece
sem correção, servindo como candidato legítimo à PR de homologação.

## Escopo deste marco — código em branch de QA, sem execução remota

`scripts/ci_autofix_doc_live_writer.py` implementa uma função **de
biblioteca** `execute_manually_authorized_document_draft` e uma classe
`DocumentDraftAppTransport`. **Não há CLI, workflow, schedule, gatilho,
bot ou chamada à função na configuração do repositório.**

O token, se uma execução vier a ser aprovada em outra etapa, deverá
ser fornecido por um operador confiável. O módulo não lê PEM,
secrets, token de variável de ambiente ou GitHub Actions. Nenhuma
credencial foi utilizada na criação/teste desta PR.

### Transação futura (somente com autorização expressa)

0. Exigir o texto estático `CREATE_ONE_ATRIO_DOCUMENT_QA_DRAFT_ONLY`,
   SHA exato, cliente de tipo permitido e plano fixo por receita.
   A constante não é prova de autorização por si: quem integra o fluxo
   precisa documentar a aprovação específica do proprietário.
1. Usar a classe **GET-only** já revisada para conferir instalação
   limitada a um repositório, `main`, ausência de branch QA, inclusive
   PRs antigas encerradas, arquivo remoto idêntico e hash Git blob
   `12f8eecb3c4cb203c60f8f2bfeaf0fd476873a95`.
   Repetir leitura de estado antes de escrever.
2. Operação potencial `POST /git/refs`: criar **apenas** a branch
   `qa/autofix-doc-history-v1` a partir da `main` revisada, sem force.
   Conferir resposta, SHA, branch e bytes do arquivo.
3. Operação potencial `PUT /contents/docs/ci/autocorrecao-automatica-
   github-app-2026-11-12.md`: atualizar **somente** esse documento
   com o texto aprovado e com o SHA do blob antigo; conferir SHA do
   conteúdo, commit novo e leitura remota byte a byte.
4. Antes da PR, conferir novamente `main`, ausência de PR duplicada,
   SHA da branch e `compare` com exatamente **um commit e um arquivo**
   de documentação modificado. Toda diferença extra bloqueia.
5. Operação potencial `POST /pulls`: abrir **uma PR em rascunho**
   (`draft=true`, `maintainer_can_modify=false`). Validar resposta,
   origem, SHA, base, número e um GET de confirmação; nenhuma
   operação de merge, deploy ou promoção a `ready-for-review`.
6. Em erro parcial após criação de branch, preservar evidência:
   **sem retentativa automática, force push, remoção ou rollback remoto**.
   O operador deverá inspecionar o estado antes de qualquer nova ação.

### Regras de segurança

- URLs, método, repo, branch, documento e corpo de escrita fixos por
  receita previamente aprovada; não aceitam código/log de CI nem
  payload de PR como instrução.
- HTTPS ao host único `api.github.com`, tempo máximo de consulta,
  respostas limitadas, sem seguir redirects, sem publicar tokens.
- `GITHUB_TOKEN` não recebe permissões de escrita. Para futuro teste
  real, usar **somente** token temporário da GitHub App configurada
  no ambiente `atrio-autofix-qa`, limitado ao repositório e às
  permissões Contents e Pull requests, e descartado após o job.
- **Nenhuma alteração** em
  `.github/workflows/autofix-qa-approved-draft.yml`, Firebase,
  Cloudflare, APK assinado, banco de produção ou backups.
- A permissão para fazer merge desta PR preparatória **não concede**
  permissão para executar a função real. A transação real dependerá de
  autorização explícita adicional para a operação de escrita.
- A API pode sofrer corrida após cada checagem: qualquer divergência
  interrompe a transação, sem alegar estado seguro automaticamente.

## Evidência desta PR

`scripts/test_ci_autofix_doc_live_writer.py` simula em memória um
servidor GitHub com `GET/POST/PUT`. Mesmo os cenários de sucesso são
**somente testes com fake HTTP**, nunca criam uma PR real no GitHub.
Incluem bloqueios de token/confirmador, URI fora da allowlist, SHA antigo,
PR encerrada, branch pré-existente, drift após criação da branch,
resposta adulterada, código HTTP recusado, diffs extras, PR não-draft,
repo errado, falha parcial e ausência de CLI ou workflow conectado.

**Critério de aceite:** 100% da suíte de CI, CodeQL, Firestore, Android,
versionamento, dependências e segurança no SHA exato; PR de QA pronta
para revisão humana e **sem merge na `main` sem autorização**. A prova
real do token write e da PR draft ainda não foi realizada.
