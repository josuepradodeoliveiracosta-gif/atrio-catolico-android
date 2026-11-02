# Átrio Católico — homologação do bloqueio em notificações

**Estado: preparado para QA; não implantado na produção, não autoriza Play.**
Branch: PR #71. Data: 31/10/2026.

## Problema real, confirmado no código

O Worker `cloudflare/push-worker/src/index.js` distribuía respostas pelo tópico FCM `atrio_thread_{postId}`. Inscritos antigos nesse tópico poderiam receber push mesmo após bloquear ou ser bloqueados por alguém. Regras de segurança do Firestore não restringem envios executados pelo service account do Worker. Filtrar o feed no Android também não impede o recebimento do push.

## Caminho de testes, sem tocar em usuários reais

O fluxo de respostas agora usa obrigatoriamente `blockSafeThreadRecipients()` para verificar, via identidade de serviço, tanto `users/{autor}/blockedMembers/{destinatario}` quanto `users/{destinatario}/blockedMembers/{autor}`. Um resultado de leitura diferente de 404/200 válido aborta o evento (fail-closed). Para respostas, o Worker não publica `message.topic`, mas envia FCM por token aos destinatários aprovados e escreve avisos internos somente para eles. Se exceder **5 destinatários**, limita o envio conservadoramente e sinaliza `block_safe_capacity_suppressed`, sem publicação em tópico. O código removeu o envio de respostas para tópicos FCM mesmo quando a variável legada está ausente ou definida como `false`. **A versão de produção implantada não foi modificada nem homologada.**

**Testar primeiro em um Worker de homologação isolado**, após confirmar conta, projeto Firebase de testes, D1 separada, credenciais temporárias de QA e ausência de rotas reais. Não editar o Worker que atende usuários atuais. Esta mudança não habilita produção nem exige flag para funcionar depois de implantada. A proteção só poderá ser considerada operacional após *deploy* controlado, validação de tráfego e plano de rollback seguro.

## Critérios mínimos de aceitação

1. A publica, B comenta, C segue: nenhum bloqueio -> alertas direcionados corretos para participantes. Tópico FCM não recebe nova publicação em modo seguro.
2. A bloqueia B, depois B tenta responder / curtir / acompanhar / salvar / reagir: regras negam as novas gravações. A também não recebe alerta originado de B se o cliente antigo tentar enviar evento.
3. B bloqueia A: idem em sentido recíproco. Desbloquear dos dois lados restaura apenas as interações futuras lícitas.
4. O bloqueio ocorre **após B já se inscrever no tópico**: nem novo push de tópico nem alerta individual indevido.
5. Testar usuário que é autor do post, participante antigo, resposta direta, menção, cliente offline, troca de UID e falhas do backend.
6. Falha 401/403/429/500/503 na consulta de bloqueio: **zero mensagens FCM e zero gravações internas novas** para o evento. Conferir logs sem IDs, tokens ou conteúdo pessoal.
7. Falha na resposta de D1 ou FCM não provoca loop de envio; deduplicação, auditoria anônima e limitação do Free precisam seguir funcionais.
8. Mais de cinco destinatários: **falha de capacidade segura**, sem tópico nem aviso parcial para bloqueados. Definir estratégia de escalonamento com custo e requisitos antes de ampliar o grupo.
9. Emulador Firestore com duas contas, testes Node do Worker e teste Android real obrigatórios; validar o pacote Play somente após existir faixa fechada.

## Gatilhos e controles

- A suíte `cloudflare/push-worker/src/index.test.js` contém testes de filtragem bilateral, falhas de consulta, limites de capacidade e exercício completo com FCM/Firestore simulados; a integração padrão verifica ausência de tópico sem a flag e mesmo se a flag legada estiver em `false`.
- A suíte `tests/security/user-safety.test.mjs` testa regras Firestore de respostas, curtidas, salvos, seguir, reações e denúncias.
- CI: `cloudflare-push-ci.yml`, `selos-ci.yml` e `play-closed-aab-ci.yml`. Passar no CI não comprova implantação, autenticação dos dados reais ou instalação pela Google Play.
- **Não marcar** `block_users` ou `closed_track_ugc_e2e` como verificados sem prova revisada, URL HTTPS de evidência válida, versão da política, testadores e validação de ponta a ponta.
- **Não assinar nem publicar AAB por causa dessa mudança isolada.** Privacidade/exclusão real, termos publicados, moderação e Play Console são bloqueios separados.

## Impedimentos e rollback

A habilitação em produção depende de plano de compatibilidade com APKs já instalados, testes de carga/limites de subrequests, e aprovação de mudança do serviço. **Reimplantar uma revisão antiga do Worker NÃO é um rollback seguro enquanto usuários tiverem bloqueios**, porque reativaria broadcast tópico sem controle por destinatário. Em um incidente, preferir suspender *envios de respostas* de forma controlada até restaurar o filtro, preservando o restante dos dados e a triagem da comunidade. O rollout deve ter circuito de corte seguro e plano de acompanhamento humano.

Apenas equipes com acesso autorizado podem publicar o Worker; nenhuma chave de serviço deve ser adicionada ao GitHub, ao APK ou a este documento.


## Bloqueio preventivo para conta em exclusão — PR #71

A função `blockSafeThreadRecipients()` passou a consultar
`account_deletion_freeze/{uid}` para remetente e destinatários antes
de fazer envios individuais ou gravar novas notificações de resposta.
Um marcador existente suprime o destinatário; se o remetente estiver
congelado, suprime todo o evento. Uma falha de consulta (diferente de
404) interrompe o evento com erro, sem tratar ausência de conexão como
ausência de congelamento. São três testes novos com Firestore simulado:
destinatário congelado, remetente congelado e falha de leitura.

**Limites:** esta é uma verificação preventiva, não um mecanismo de
exclusão atômica. Não impede uma escrita que já estava em trânsito ou
uma operação privilegiada iniciada após a leitura do marcador. Precisa
de barreira persistente coordenada com Admin SDK e com os demais
Workers, e de auditoria de filas/cron/broadcast. A regra Firestore para
o marcador também não foi implantada na produção. Não declarar
`worker_freeze` nem `push_block_safe_delivery` como homologados.

## Continuação da PR #71 — bloqueio de Push não relacionado a respostas (02/11/2026)

A candidata passa a aplicar `filterNonReplyRecipientsForDeletion()` também aos
eventos autenticados de solicitação/resultado de selo e de denúncias
(`badge_request`, `badge_result`, `report`), antes de consultar
`pushDevices`, consumir marcadores de entrega D1 ou enviar FCM. A consulta
de `account_deletion_freeze/{uid}` cobre **remetente e destinatários**;
falhas de leitura abortam integralmente o evento. Destinatários repetidos são
deduplicados e IDs inválidos ou além da capacidade são rejeitados.
Os testes adicionados a `review-freeze.test.js` cobrem destinatário e
emissor congelados, falha de rede, validação e o fluxo HTTP sintético
de resultado de selo. Evita duplicar suites de Android/Play já concluídas.

**Limites:** verificação remota de marcador é preflight, não fence distribuído
atômico; o envio geral por tópico `atrio_comunicados_v1` continua sem
filtragem individual de contas congeladas. Execuções já em trânsito também
precisam de coordenação. Os três Workers de produção não foram atualizados;
nenhuma evidência UGC/privacidade passa a `verified:true`. Não liberar AAB.

## 02/11/2026 — bloqueio dos comunicados por tópico e QA de barreira distribuída

**Alteração somente na PR #71:** o endpoint `POST /broadcast` ainda valida
identidade, privilégios do fundador, conteúdo e marcador de exclusão do
emissor. Porém, agora nunca faz broadcast por tópico FCM, consulta de tokens
nem atualiza o cooldown D1. Mesmo com `BROADCAST_ENABLED=true` e uma
flag experimental de coordenador, a operação válida termina em
`503 broadcast_privacy_coordinator_required`. Um fundador congelado continua
bloqueado em `409 account_deletion_in_progress`. Nenhum envio real será
feito pelo novo código até a homologação de um cadastro individual completo
e de permissões persistentes de todos os destinatários.

O teste isolado de Service Binding/D1 foi ampliado para aceitar a operação
`push_fcm_send` com escopo `actorUid,recipientUids` e exigir **uma
admissão atômica para todas as contas do lote**, inclusive o remetente.
Após `draining`, nova operação é recusada; `frozen` só é permitido quando
não existe ticket em trânsito; um reconciliador independente confirma o
encerramento. UID real, duplicatas, lista vazia e bypass por metade do ticket
são recusados. O protocolo continua estritamente limitado às contas
fictícias `qa-freeze-alice` e `qa-freeze-bob`, sem FCM, Cloudinary ou Firebase
reais. A cobertura do QA não implica integração operacional.

O contrato de integridade do source Push recebeu novo blob SHA-1, sem
suprimir a validação, corrigindo a falha de pin divergente observada no
CI anterior. Testes direcionados de Push e da barreira bastam nesta revisão;
não repetir testes Android/AAB previamente executados sem alteração pertinente.

**Pendente:** inventário paginado de todos os usuários com cobertura comprovada,
controle de consentimento, divisão de lotes, limites/custos, tickets de efeito
externo, reconciliação FCM sob falha, IAM, revisão independente e integração
real dos três Workers antes de qualquer remoção em produção. Não marcar
`worker_freeze`, `push_block_safe_delivery` ou qualquer evidência
`verified:true`; sem merge, assinatura, deploy ou Play Console.

## QA — inventário paginado e entrega individual sob autorização D1 (02/11/2026)

A PR #71 possui agora `cloudflare/account-deletion-audit/src/qa-broadcast-inventory.js`,
módulo **somente para testes** e sem nenhuma implementação de acesso à rede.
O cenário contém exclusivamente `qa-freeze-alice` e `qa-freeze-bob`.
O conjunto é percorrido em **duas páginas**, identificadas por cursor e
revisão fixa. Cada página deve comprovar posição sequencial, revisão
consistente, total esperado, ordenação, ausência de duplicatas, formato de
UID e token fictícios, consentimento explícito (`optedIn`) e término
declarado (`complete=true`, `nextCursor=null`). Falhas, respostas
incompletas, paginação desordenada, troca de revisão e divergência de
contagem impedem qualquer emissão ou aquisição de autorização.

Somente após **todo** o inventário sintético ser verificado, o adaptador
solicita `/v1/admit` pelo Service Binding HMAC existente. A barreira D1
faz admissão atômica de remetente e destinatário, impedindo a operação
quando qualquer conta estiver `draining` ou `frozen`. O componente
`sendFixture` injeta somente um efeito local simulado, com token
`qa-fcm-...`, sem FCM real ou tópico; nenhuma mensagem é enviada a
usuários verdadeiros. Mesmo no cenário simulado de aceitação, a operação
fica **pendente** até que um reconciliador independente apresente a prova
fictícia necessária para liberar o ticket no D1. Falha ambígua não gera
retry nem apaga ticket: o congelamento aguarda conciliação.

Os testes adicionais executam o fluxo HMAC/D1 completo, atravessam duas
páginas, confirmam opt-out, inconsistências de inventário, UID/token real,
conta congelada e efeito incerto. Um teste guarda `globalThis.fetch`
para demonstrar que o fluxo de fixture não usa rede externa.

**Limitações que continuam bloqueando a Play e produção:**
- O total e a revisão são **declarações de uma fonte fictícia confiável**.
  Contar linhas não prova, por si, que um banco vivo não omitiu contas:
  é necessária visão consistente e exaustiva do cadastro verdadeiro.
- O Service Binding só admite duas identidades sintéticas; ainda não
  suporta lotes paginados numerosos, IAM operacional ou custos reais.
- Falta deduplicação persistente por ID de comunicado, controle de
  reprocessamentos e reconciliação de respostas externas FCM. Uma
  aceitação sintética **não é prova de entrega em dispositivo**.
- O endpoint verdadeiro `POST /broadcast` permanece **bloqueado**
  em `broadcast_privacy_coordinator_required`. Nenhuma flag libera
  tópicos nem invoca o pipeline de QA em produção.

Sem deploy, sem tocar no Firebase/FCM/Cloudinary reais, sem assinatura,
sem merge, sem alteração da `main` ou de backup, e sem marcar requisitos
de privacidade como verificados.
