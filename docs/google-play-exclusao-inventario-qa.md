# Revisão de inventário e ordem de exclusão — QA (PR #71)

**Somente simulação, sem conexão com serviços reais.** Esta etapa integra seletivamente
quatro arquivos de auditoria da PR #98 na branch Play. O módulo de revisão
`cloudflare/account-deletion-audit/src/deletion-orchestrator.js` **nunca** executa
remoção; `safeToExecute:false` e `simulatedOnly:true` permanecem em todo plano.

## Garantias verificadas pelos testes

- Confirma que existe solicitação, que o titular foi verificado e que houve
  revisão de retenção e aprovação humana, mesmo para **simulações**.
- Bloqueia inventário incompleto, dados de usuários diferentes, caminhos fora
  da lista aprovada, recursos externos com proprietário divergente e coleções
  desconhecidas; exige revisão de dados relacionados e mídia Cloudinary.
- Expõe apenas **contagens agregadas** e fases de processamento, sem devolver
  nomes, e-mails, identificadores de mídia ou o caminho completo dos dados.
- Exige congelamento de novas escritas, remoção de dependências/subcoleções,
  decisão de retenção, revarredura e **Firebase Authentication somente por último**.
- Permite ensaiar checkpoints/reinícios e falhas, mas o simulador não contém
  chamadas a Firestore Admin SDK, Cloudinary ou Firebase Authentication.

Os testes rodam na CI AAB já existente:

```bash
npm --prefix cloudflare/account-deletion-audit test
```

Este módulo **não** equivale a executor aprovado. O projeto continua sem
fencing operacional em Workers, decisão jurídica de retenção, inventário real
completo, monitoramento, portal HTTPS habilitado e prova de exclusão E2E.
Não ativar escrita/exclusão de produção nem alterar evidências para `verified:true`.


## Barreira de escrita privilegiada — ensaio SQLite isolado

A barreira de `qa-privileged-write-barrier.js`, importada da PR #98,
opera **somente com dois UIDs fictícios**: `qa-freeze-alice` e
`qa-freeze-bob`. A DDL `qa-privileged-freeze-schema.sql` bloqueia
outros identificadores com `CHECK`. Não configurar conexões Cloudflare D1
de produção nem misturar a tabela de QA aos bancos existentes.

O teste de `node:sqlite` verifica admissão atômica de operações que
envolvem remetente e destinatário, transição `active → draining → frozen`,
persistência após reconexão, proibição de novos efeitos e bloqueio da
conclusão diante de efeitos Cloudinary/FCM de resultado desconhecido.
São ensaios de funções simuladas: **não existem operações reais de Worker,
Firebase Admin ou Cloudinary** nesses arquivos.

A CI já existente do AAB os descobre via
`npm --prefix cloudflare/account-deletion-audit test`; não foi adicionado
workflow ou deploy. Antes de qualquer liberação é necessário integrar e
auditar **todas as rotas, cron jobs, filas, fanouts e gravações privilegiadas
reais dos três Workers**, além dos serviços já implantados, e confirmar
que a coordenação é durável e compartilhada entre processos. Esta barreira
isolada **não** protege contas de produção e não torna a exclusão
efetiva, conforme `releaseAuthorized:false`.

## Verificação independente do identificador de mídia (01/11/2026)

O plano `buildDeletionPlan` agora recusa identificadores de avatar Cloudinary
que não obedeçam ao namespace `atrio-avatares/{uid}/{uuid}` do próprio titular,
mesmo quando o registro informar `ownerUid` correto. Abrange os três escopos
`cloudinary_avatar_upload`, `cloudinary_avatar_pending` e
`cloudinary_avatar_authenticated`. Referências `firebase_auth` só são
aceitas quando a chave corresponde exatamente ao UID. A suíte testa também
IDs de mídia pertencentes a terceiros e IDs com caminho adulterado.

**Limites:** isso é uma verificação estrutural de QA, não prova de que a imagem
existe ou de que um token FCM pertence ao usuário. A origem do inventário,
as permissões de leitura, a prova de vínculo de FCM e Cloudinary, os dados
legados, a retenção jurídica e o fencing continuam pendentes. Nenhum
recurso é excluído, nenhuma credencial consultada, e o retorno do plano
permanece `safeToExecute:false`.

## Cobertura explícita obrigatória do inventário (01/11/2026)

O planejamento QA de exclusão deixou de aceitar campos omitidos como se fossem
uma prova negativa. `hasUnknownCollections`, `hasLegalHold`,
`contentReferencesUnresolved` e `mediaStateUncertain` agora exigem valores
booleanos explícitos; ausência, `null`, string ou tipos não esperados bloqueiam
a revisão. A lista `scopesComplete` deve corresponder exatamente aos escopos
reconhecidos, sem duplicação ou adição de nomes desconhecidos. Entradas de
recursos externos duplicadas e chaves vazias também são rejeitadas.

Os novos testes de regressão ensaiam omissão, tipo incorreto, escopo duplicado,
escopo desconhecido e referências externas repetidas, preservando o caminho
válido de QA. **Isso não confere autenticidade aos campos:** a origem ainda
deve ser um backend administrativo verificado, e o plano permanece
`simulatedOnly:true`, `safeToExecute:false`, sem integração com contas reais.

## Validação da consulta de inventário Firestore por resposta HTTP (01/11/2026)

O adaptador somente-leitura \`relational-firestore-read-adapter.js\` foi
reforçado para interpretar corretamente a estrutura documentada de
\`RunQueryResponse\`: pode haver resposta vazia com \`readTime\`, ou
marcador terminal \`done:true\`. A auditoria agora bloqueia
\`skippedResults\` diferente de zero, envelopes não esperados,
horários inválidos, caminhos de outras coleções, outros UIDs, campos
adicionais, ordem incorreta e respostas excessivas em bytes.

O teste do adaptador usa exclusivamente transporte HTTP simulado,
sem token OAuth válido, IAM ou dados reais. A leitura de páginas
separadas não estabelece snapshot global imutável, mesmo com horário
válido; reconciliação repetida e fencing real continuam obrigatórios.

## Leitura de documentos próprios e subcoleções órfãs (01/11/2026)

Foram integrados da PR #98 os módulos `owned-inventory.js` e
`firestore-read-adapter.js`, com testes independentes. O inventário faz
somente leituras dos caminhos aprovados de perfil, conta e subcoleções
(e.g. notificações, bloqueios, consentimentos, dispositivos Push), mesmo
se o documento pai `users/{uid}` tiver sido removido.

O adaptador HTTP REST restringe projeto, caminho e paginação antes de
consultar o Firestore. Uma resposta HTTP 200 para documento **diferente**
do solicitado, documento sem `name` validado, coleção com metadados
inesperados, UID alheio, cursor inválido, página repetida ou payload
excessivo em bytes interrompe o inventário; o resultado nunca pode ser
interpretado como autorização de exclusão. Essa inspeção não expõe e-mails,
tokens ou conteúdo dos documentos no resultado.

O módulo é **biblioteca sem integração com endpoints**, sem token real,
deploy ou escrita; `pagesComplete:false`, `hasUnknownCollections:true`,
`safeToExecute:false` no plano derivado continuam impedindo execução.
Ainda exige a varredura relacional, referências de terceiros, mídia,
retenção legal, monitoramento de Workers e barreira distribuída.

## Coordenador de bloqueio distribuído — homologação separada (02/11/2026)

A PR da Play Store agora incorpora seletivamente o protótipo de staging da PR #98 em `cloudflare/privacy-freeze-stage`, preservando exatamente os objetos Git revisados. Ele inclui Worker interno, cliente para Service Binding, protocolo HMAC com nonces e D1 para tickets de gravação. O SQL limita identificadores exclusivamente aos usuários fictícios `qa-freeze-alice` e `qa-freeze-bob`. O arquivo `wrangler.staging.example.toml` usa identificador D1 placeholder, `workers_dev=false`, sem rotas públicas; **não há configuração executável de deploy nem segredos commitados**.

Os três testes `qa-stage-{preflight,service-binding,cloudflare-drill}.test.js` são incluídos na suíte Node `cloudflare/account-deletion-audit`, já obrigatória no CI do AAB. Validam o isolamento de staging, papéis, HMAC anti-replay, operações compartilhadas entre serviços e retomada sobre SQLite local. Este código não é conectado aos três Workers de produção e não executa exclusão real.

**Pendente para homologar:** integrar admissão, drenagem e reconciliação no caminho de cada escrita real de Avatar, Guardião e Push, em implantação segregada com autorização, IAM específico, inventário e retenção. `worker_freeze` continua sem verificação operacional; `releaseAuthorized:false`.
