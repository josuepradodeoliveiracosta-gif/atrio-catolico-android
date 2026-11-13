# Piloto QA — nova receita documental para futura PR draft pela GitHub App

**Situação em 13/11/2026:** diagnóstico automático e token de instalação
com permissões de leitura validados no GitHub. **Ainda não foi demonstrada
criação automática de uma PR draft com token Contents/Pull requests write.**

## Candidata real, não uma falha fabricada

O documento `docs/ci/autocorrecao-automatica-github-app-2026-11-12.md`
ainda orienta o proprietário a *revisar e integrar a PR #260*. Essa PR já
foi integrada; a seção possui também numeração `5.` repetida.
A proposta real é substituir apenas essas três linhas por uma instrução
depois das PRs #260/#262, sem reaplicar a mudança da #261.

O arquivo original está fixado pelo **Git blob SHA-1**
`12f8eecb3c4cb203c60f8f2bfeaf0fd476873a95`.
Uma alteração ou troca do arquivo, symlink, trecho duplicado, novo
conteúdo desconhecido ou diff acima do limite bloqueiam a receita.
Não se pode tratar um documento distinto como correção elegível.

## Etapa A — prévia sem escrita (esta PR)

- `scripts/ci_autofix_doc_candidate.py`: reconhece uma fonte imutável,
  aplica somente uma substituição textual codificada no próprio módulo,
  prova mudança e rollback em diretório temporário e preserva o checkout.
- O retorno explicita `remote_writes=0`, `automatic_pull_requests_created=0`,
  `production_access=false` e necessidade de **autorização humana
  separada antes de qualquer operação da GitHub App com write**.
- `scripts/test_ci_autofix_doc_candidate.py`: valida origem esperada,
  bloqueio de conteúdo antigo ausente/duplicado, arquivo alterado,
  symlink, sandbox e ausência de API de escrita. Integrado no check
  obrigatório Firestore/QA da PR.
- **Não modifica o documento candidato original**; assim a necessidade
  legítima de correção permanece visível e a prévia pode ser revalidada.
- Nenhuma alteração de `.github/workflows/autofix-qa-approved-draft.yml`
  e nenhuma emissão de token `write` neste marco.

## Etapa B — futura homologação de escrita (não autorizada ainda)

Após a presente PR ser revisada e aprovada, projetar uma **transação
separada, estritamente limitada ao documento indicado**. Antes de
propor execução, demonstrar em testes sem rede:

1. Origem confiável `main` e SHA atual, App instalada só no repo;
   documento com Git blob SHA e conteúdo fixo, sem symlink nem drift
2. Nova branch QA de nome fixo, ausente; nenhuma PR aberta/fechada
   conflitante; readback do arquivo e diff de **um único arquivo**
3. Token efêmero de instalação com Contents/Pull requests write
   obtido **somente após** todas as validações de leitura, no
   ambiente protegido, sem persistir nem imprimir credencial
4. Transação mínima: criar apenas a branch QA, atualizar somente
   o arquivo permitido e abrir **uma PR draft**, nunca fazer merge,
   deploy, upload de APK, operação Firebase/Cloudflare ou backup
5. Falha parcial: parar e solicitar inspeção humana; nenhuma
   substituição forçada, limpeza destrutiva ou retry automático
6. Execução real **somente após autorização humana expressa específica**;
   revisar evidência e checks da PR criada antes de qualquer merge

**Este pré-requisito não amplia as permissões do workflow automático atual.**
A receita existente de `scripts/ci_quality_report.py` continua bloqueada
porque sua correção já está aplicada, e não será simulada artificialmente.

## Critérios de aceitação da etapa A

- CI de Firestore, Android, CodeQL, segredos e versionamento aprovada
- Teste real de fonte fixa e 9 cenários offline de falha/segurança verdes
- PR separada e em rascunho, `main` sem mudanças até nova autorização
- Nenhum token ou secret acessado; zero escrita remota pela receita
