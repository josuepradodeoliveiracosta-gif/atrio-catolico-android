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
