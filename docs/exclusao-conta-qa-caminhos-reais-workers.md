# Átrio Católico — Testes de caminhos reais de Workers com bloqueio de QA

**31/10/2026 — Esta etapa não altera os Workers publicados e não habilita exclusões reais.**

## Dependência

A PR desta etapa depende da #85, que depende das etapas anteriores de privacidade até a #73. A [issue #72](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/72) continua aberta. O código é isolado em `cloudflare/account-deletion-audit/` e só usa identidades fictícias.

## Integração de código real sob controle de QA

`src/qa-actual-worker-paths.js` importa e executa **funções exportadas existentes** dos Workers (não substitutos dessas funções):

| Worker | Função existente testada | Proteção simulada |
|---|---|---|
| Avatar | `avatarWorker.fetch` com `POST /avatar/status` (sem avatar pendente) | `avatar_promote`, titular fictícia |
| Guardião | `reviewCase` confirmando revisão de caso fictício | `guardian_review_write`, titular e revisor fictícios |
| Push | `writeThreadNotices` preparando gravação de aviso no Firestore | `push_thread_notice`, emissor e destinatário fictícios |

A barreira de QA da PR #85 concede ingresso **antes de chamar a função real**. Se o titular estiver em `draining` ou `frozen`, nenhuma das três funções é executada. Caso a chamada ou confirmação simulada falhe ou tenha resultado desconhecido, o ticket permanece aberto; a conta **não** pode ser declarada congelada até reconciliação.

As respostas de autenticação Firebase, o banco de avatar D1 e o Firestore REST são **simulados**. Não há API Cloudinary real, FCM real, IAM administrativo, domínio publicado ou rede externa. Os métodos e as URLs permitidas são fixos e as requisições são interceptadas por transporte falso. O ambiente de teste exige `ATRIO_PRIVILEGED_QA_ONLY=true` e rejeita credenciais administrativas reais.

## Atenção: o que ainda NÃO foi implementado

**Isto é uma camada de integração de QA e não uma proteção ativa dos Workers.** A barreira ainda não é chamada pelos endpoints de produção, filas, tarefas agendadas, upload de mídia real ou todas as rotas administrativas. A execução de `avatar/status` com ausência de pendências é um cenário limitado; não cobre a promoção completa, nem upload, nem exclusão de fotos.

O controle D1 da barreira e o marcador Firestore da PR #84 estão em sistemas diferentes e não formam uma transação distribuída. É indispensável lidar com operações em trânsito, Workers antigos, reconciliação de tickets, casos de retenção e referências cruzadas antes de considerar uma conta pronta para exclusão.

Ainda faltam homologar todas as rotas privilegiadas, o D1 em ambiente remoto isolado, IAM mínimo, inventário completo, retenção, processador efetivo, exclusão Auth/Cloudinary/Firestore com verificações finais e o portal HTTPS público de solicitação de exclusão para a Play Store.

## Como validar

O workflow de privacidade já executa automaticamente arquivos `src/*.test.js` com SQLite em QA:

```bash
node --experimental-sqlite --test cloudflare/account-deletion-audit/src/qa-actual-worker-paths.test.js
```

**Não mesclar a PR para habilitar exclusão em produção**, não implantar seus módulos nos Workers reais e não vincular credenciais. Nenhuma alteração à OTA, APK/AAB, assinatura permanente ou backups foi realizada.
