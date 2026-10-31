# Privacidade QA — bloqueio individual integrado à entrada real do Push Worker

**PR #98 | Exclusivamente homologação isolada | 31/10/2026**

## O avanço implementado

O código executável `cloudflare/push-worker/src/index.js` agora tem um **modo opt-in isolado**, `ATRIO_PRIVACY_QA_SCOPED_FENCE`. No modo ativo, a rota real de eventos, notificações, comunicados, moderação e a fila de bots **não executam operações**, nem acessam credenciais, banco D1, FCM ou Firebase.

Somente um exercício de entrada HTTP com **URL fixa e não pública** (`https://qa-only.invalid/__qa/privacy/reply`) pode avançar, e apenas quando:

- a opção tem valor exato `true`;
- `ATRIO_QA_PRIVACY_FIXTURE` é `demo-atrio-v11`;
- nenhuma binding real de Firebase, Cloudflare D1, IA ou segredo está presente;
- os adaptadores de barreira de contas, banco SQLite em memória, entrega fictícia e verificação fictícia foram **injetados pelo teste local**;
- o corpo tem no máximo 256 bytes e contém somente `actorUid`, `recipientUid`, `postId`, `replyId` com valores pertencentes ao pequeno conjunto de fixtures: `qa-freeze-alice`, `qa-freeze-bob`, `qa_post`, `qa_reply`.

Sem configuração, o aplicativo/Worker continuam com o comportamento anterior. Se o modo for ativado por engano em domínio externo, com credenciais reais ou sem fixture, a entrada é recusada. A trava geral `ATRIO_PRIVACY_QA_WRITE_FENCE` tem prioridade.

## Ciclo de escrita fictícia

`privacy-qa-scoped-fence.js` mantém **um único ticket atômico SQLite para autor e destinatário**, obtido **antes** do `INSERT OR IGNORE` no registro fictício de evento. Um envio fictício só ocorre após a reserva, e o ticket só é liberado após verificação independente, também fictícia.

- Conta **draining/frozen**: recusa antes de tocar no marcador ou no envio;
- ticket em andamento: congelamento final é bloqueado até conclusão verificada;
- resultado ambíguo, erro ou verificação negativa: ticket permanece aberto, impedindo conclusão indevida;
- notificação duplicada: não reenvia;
- tópico/broadcast, UID real, campo extra e host externo: bloqueados.

`qa-push-scoped-real-worker.test.js` exercita **a rota `worker.fetch` e a `worker.queue` originais**, com rede proibida, banco local e acesso a credenciais monitorado. A suíte roda pela auditoria já existente na CI da PR #98.

## Limitações — NÃO está pronto para publicação

O novo mecanismo é **uma integração executável de teste**, e não uma proteção distribuída instalada. O backend de congelamento por UID é ainda SQLite de fixture, não um serviço confiável compartilhado pelos Workers. Uma chamada fora do modo QA ou um Worker antigo implantado ainda pode escrever normalmente.

Não há implantação Cloudflare, configuração Wrangler, IAM real, autorização administrativa real, envio FCM real, exclusão de Auth/Firestore/Cloudinary ou política de retenção homologada.

**O modo QA individual nunca deve ser configurado na produção.** A próxima integração precisará de autorização administrativa, armazenamento durável compartilhado, reconciliação de efeitos, cobertura de Avatar/Guardião/Push, e testes segregados completos.

`productionIntegrated:false`; `safeToDeleteRealAccounts:false`. Issue #72 segue aberta; checklist Google Play de nove evidências segue bloqueado. `main`, backups, assinatura, APK/AAB e OTA não foram modificados.
