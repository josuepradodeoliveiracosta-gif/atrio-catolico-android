# Consolidação das PRs de privacidade do Átrio Católico

**Decisão:** manter a PR #98 como o único ponto de continuação e revisão
do código de solicitação e exclusão de conta em QA; manter o acompanhamento
da issue #72 aberto; não mesclar, ativar nem implantar a exclusão real.

## Inventário verificável de preservação

O histórico da PR #98 já continha a linha principal de alterações das
PRs #73–#98. Verificações de comparação do GitHub identificaram quatro
PRs cujos commits não faziam parte da ancestralidade direta: #75,
#76, #86 e #88. Para não perder sua contribuição, os arquivos exclusivos
foram importados **com o mesmo SHA de blob Git**, sem reescrever conteúdo:

- #75 — 12 arquivos exclusivos: portal e plano web Cloudflare,
  workflow e documentação. Os requisitos compartilhados de
  \`firestore.rules\` para pedidos \`web\` e as regressões de
  \`account-deletion-request.test.mjs\` já estão cobertos e
  ampliados pela #98.
- #76 — 4 arquivos exclusivos: inventário, simulador, teste e
  documentação. O workflow existente da #98 já executa todos os
  testes \`cloudflare/account-deletion-audit/src/*.test.js\`.
- #86 — 3 arquivos exclusivos: ensaio de rotas reais dos Workers,
  testes e documentação.
- #88 — 4 arquivos exclusivos: contrato de cobertura de Workers,
  ensaio da revisão do Guardião e documentação.

Os PRs antigos são preservados no histórico do GitHub; encerrar um PR
**não** exclui sua branch ou commits, e **não** equivale a merge.
A documentação de cada etapa permanece acessível no Git.

## Fluxo de trabalho simplificado

1. **PR #98** é o único PR ativo para desenvolvimento em QA do executor
   de privacidade. Novas alterações relacionadas devem ser **commits
   na mesma branch**, mantendo testes, revisões e QA automatizada.
2. **PR #71** continua separada para empacotamento de AAB e Play Store.
3. **PR #70** continua separada para assinatura/OTA e fluxo Android.
4. A **issue #72** permanece aberta como bloqueio de conformidade:
   não habilitar exclusão real sem IAM, retenção, reconciliação global,
   cobertura de todas as rotas backend, Cloudinary real e portal HTTPS.

PRs antigas #73–#97 podem ser encerradas como **substituídas** pela #98
**somente após** confirmar que o teste de CI da árvore consolidada passou.
Não excluir branches; se surgir lacuna de funcionalidade,
recuperar a partir do histórico sem reescrever backups.

## Segurança e limites

A consolidação modifica apenas uma branch draft. Não altera a \`main\`,
não executa deploy, não muda os serviços Firebase/Cloudflare reais,
não modifica APK, AAB, OTA, assinatura, \`versionCode\`, nem backup
protegido. A inclusão do portal é apenas código e testes de build;
a configuração que permitiria exclusão real permanece desabilitada.

**Estado:** produção intocada, QA apenas, issue #72 aberta.

## Cobertura de UGC da PR #71 no executor QA

A PR #71 introduziu bloqueios privados e denúncias de usuários, além do aceite
versionado dos Termos. O ensaio de exclusão na PR #98 foi ampliado para garantir
que uma remoção não se limite aos dados antigos:

- `QaDeletionRunner` semeia e elimina em `demo-atrio-v11` somente
  `users/qa-delete-alice/blockedMembers/qa-delete-bob` e
  `users/qa-delete-alice/acceptedTerms/ugc-v1`, usando o inventário genérico
  de subcoleções próprio do titular.
- Dados equivalentes de **Bob** permanecem intactos; a identidade fictícia de
  Bob e a foto simulada continuam existentes após o ensaio.
- `user_reports` são registros de moderação com possíveis interesses de
  terceiros. Os testes injetam um relatório com Alice como denunciante ou
  denunciada após limpar seus dados próprios e exigem bloqueio da remoção de
  Auth simulado enquanto persistirem referências. **Não é seguro eliminar
  automaticamente denúncias com base apenas no UID**.
- A reconciliação executa consultas independentes por `reporterUid` e
  `targetUid`. O estado continua `productionReady:false` e
  `globalCoverageComplete:false`.

Esses testes não substituem a decisão de retenção, a anonimização necessária
nem a implementação de exclusão real. Nenhum relatório, usuário ou conteúdo
de produção foi acessado ou apagado. A issue #72 e o manifesto de privacidade
continuam bloqueados.

