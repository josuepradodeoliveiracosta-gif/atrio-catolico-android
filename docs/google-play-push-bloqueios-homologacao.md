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

## QA — lotes, deduplicação persistente e falha parcial (02/11/2026)

Sem tocar no contrato HMAC de duas contas, foi criado um **ensaio adicional
SQLite local** em `cloudflare/account-deletion-audit/src/qa-broadcast-batches.js`
e `qa-broadcast-batches-fixture.sql`. Seu banco aceita apenas nove identidades
`qa-batch-00..08` e tokens `qa-fcm-...`. **Não é um Worker Cloudflare, nem
um adaptador D1 de produção**. O uso de duas conexões SQLite simula
serialização entre processos; o protocolo de Service Binding anterior
continua preservado e limitado a duas contas.

- Inventário completo é validado *antes* de qualquer reserva: até nove
  participantes fictícios, páginas de até três registros, revisão fixa,
  cursor sequencial, ordem estável, consentimento, ausência de duplicações
  e total esperado. Total declarado pelo fixture não é prova de exaustividade
  de um cadastro real.
- Cada pedido `qa-broadcast-...` grava uma identidade e um digest do
  inventário em transação única; o mesmo pedido e conteúdo não cria
  novas entregas, e reuso com conteúdo diferente é rejeitado, inclusive
  após reabrir a conexão.
- Processamento individual em lotes explícitos de até **três** destinatários
  usa reserva persistente por pedido e por destinatário. Antes de cada
  tentativa simulada, uma operação SQL atômica confere que **remetente e
  destinatário** estão `active`. Mudanças de estado `draining`
  suspendem novas operações; não há fallback para tópico.
- Um retorno fictício de aceitação registra `acked`, mas mantém o ticket
  como pendência de exclusão até confirmação separada. Falha incerta
  registra `ambiguous`, interrompe imediatamente o lote e impede
  reexecução automática. Um lease `processing` abandonado continua
  bloqueado, evitando duplicação depois de reinício.
- Somente o reconciliador do **ensaio** aceita evidência sintética explícita
  para finalizar os tickets e autorizar o congelamento. Uma prova real de
  entrega não foi obtida, e a confirmação de FCM não garante entrega ao
  aparelho.

Os testes específicos verificam três páginas, lotes 3+3+2, reinício,
concorrência entre conexões, deduplicação, falha parcial, bloqueio de conta
durante envio, opt-out, paginação inconsistente e rejeição de UID real.
Não há qualquer acesso real a Firebase, Cloudflare ou serviços de produção.

**Aprovação para Play permanece bloqueada.** Falta adaptar o protocolo
para D1 real e processamento distribuído (controle de leases, idempotência
e reconciliação com IAM independente), implementar captura exaustiva de
usuários reais com visão consistente, dimensionar limites de custo e
comprovar bloqueios e exclusão efetiva em homologação. O endpoint
`POST /broadcast` continua bloqueado.

## Simulação autenticada de serviços para lotes (PR #71, 02/11/2026)

A etapa seguinte incorpora
`cloudflare/account-deletion-audit/src/qa-batch-stage.js`, um **emulador local
Node/SQLite de Service Binding**, com origem interna fixa,
HMAC-SHA256 por função (`push`, `admin`, `reconciler`), nonce exclusivo
persistido em `qa_bcast_nonces`, janela de autenticação de 60 segundos,
corpo UTF-8 limitado e validação exata de rota, papel e escopo.
O cliente chama apenas `binding.fetch` fornecido por injeção de
dependências, sem nenhuma chamada à rede pública.

O emissor de fixture pode planejar um comunicado e processar um lote.
O administrador simulado pode consultar, iniciar e finalizar congelamento.
Somente o reconciliador com segredo **separado** pode declarar a evidência
sintética de um efeito e encerrar o respectivo registro. O consumo
de um nonce é atômico e persiste no SQLite mesmo que uma operação seja
negada; uma repetição idêntica é recusada após reabertura do banco.
Falhas durante o envio simulado permanecem marcadas como ambíguas,
interrompendo o lote e impedindo novo envio automático após reinício.

A combinação dos testes do inventário de nove contas e deste protocolo
avalia serialização entre processos, lotes 3+3+2, autenticidade,
escopos de função, falsificação, replay, expiração, falha incerta,
congelamento e conciliação sem FCM. **Esta não é uma integração com
Cloudflare Workers ou D1 de produção:** a implementação usa
`node:sqlite`/SQLite local e não tem configuração de publicação,
rotas externas, credenciais reais nem suporte a UIDs de clientes.
`STAGE_BINDING_READINESS` e `QA_BATCH_BINDING_READINESS` mantêm
`productionIntegrated=false`.

Antes de uma homologação externa com Worker separado serão necessários
adaptador D1 compatível, persistência e IAM reais exclusivos de staging,
revisão de privilégio/segredos, autenticação com isolamento de rede,
controle de falhas de commit e de temporização, inventário completo
consistente de usuários reais, políticas de consentimento e evidência
de reconciliação independente. A candidata Play continua sem envio de
comunicados por tópico e sem autorização para publicar.

## Protótipo Worker-compatible de homologação isolada (02/11/2026)

A PR #71 passa a conter **apenas código-fonte candidato**, em
\`cloudflare/privacy-batch-stage/\`, de um Worker compatível com a interface
D1 (\`prepare/bind/first/all/run/batch\`), sem dependências \`node:sqlite\`.
A configuração é \`wrangler.staging.example.toml\`, um **modelo
intencionalmente não implantável** com \`database_id\` placeholder:
\`REPLACE_WITH_NEW_DEDICATED_QA_D1_ID\`. Não existe \`wrangler.toml\`
ativo, credencial publicada, D1 criada, deploy, rota pública ou serviço
Cloudflare configurado. Não alterar a configuração dos Workers atuais.

A migração \`migrations/0001_fixture_only.sql\` restringe os UIDs a
\`qa-batch-00\` até \`qa-batch-08\`, tokens a \`qa-fcm-fixture-...\` e
pedidos a \`qa-broadcast-...\`. Um pedido planeja exclusivamente o
conjunto imutável de oito destinatários sintéticos. Planejamento
idempotente usa um \`D1.batch()\` atômico; não existe consulta ao
cadastro Firebase ou às inscrições FCM reais. Uma operação \`process\`
simula até três entregas individuais por requisição, sem rede externa e
sem nenhuma chamada FCM. Retornos \`acked\` significam **somente
simulação**, não entrega a um dispositivo.

As rotas são acessíveis no código somente com origem interna fixa,
requisição \`POST\`, corpo limitado, HMAC-SHA256, nonce único gravado no
D1 e janela curta; \`push\`, \`admin\` e \`reconciler\` exigem três
segredos separados e autorização de rota distinta. O Worker exige
\`ATRIO_QA_BATCH_STAGE_ID=demo-atrio-batch-cloud-v1\` e
\`QA_BATCH_MODE=fixture-only\`; qualquer configuração faltante causa
negação. A atualização de um ticket para \`inflight\` verifica
atomicamente o estado \`active\` tanto do remetente quanto do
destinatário. Efeitos sintéticos ambíguos paralisam o pedido.
O serviço não reinicia automaticamente um lote interrompido: somente
o reconciliador, após liquidar tickets ambíguos, pode liberar o
lease. \`draining/frozen\` impedem novas tentativas. Falha D1 após
reserva permanece bloqueada, mesmo em outra instância.

O \`scripts/preflight.mjs --audit\` e os testes offline auditam
privacidade do template, ausência de IDs/segredos reais, migração
somente de identidades sintéticas, D1 simulado com interface compatível,
HMAC, replay após reabertura, recusa de papéis indevidos, falhas
parciais, deduplicação e congelamento. Essa auditoria é **necessária,
mas não concede autorização** para preparar segredos, criar D1,
executar migrações remotas ou fazer deploy.

**Limitações e próximos gates:** isolamento real de conta/IAM ainda
não comprovado; \`wrangler deploy\` não realizado; latência e custos
D1 reais não medidos; D1 compartilhado entre serviços ainda não
provisionado; inventário real consistente não existe; ausência
de FCM confirmado em dispositivo; reconciliação de efeitos externos
não implementada. O fluxo de produção permanece bloqueado em
\`broadcast_privacy_coordinator_required\`, e nenhuma evidência
Play/privacidade deve passar a \`verified:true\`.

Sem alteração da \`main\`, dos backups, dos Workers implantados
ou das credenciais de produção.

## Auditoria Cloudflare somente de leitura e trava do lease ativo (02/11/2026)

A consulta autenticada e **somente GET** da conexão Cloudflare atual
retornou **uma conta acessível**, com bancos D1 e Workers operacionais e
de QA coexistindo. Entre os recursos listados já existe o banco
`atrio-privacy-freeze-stage-fixtures`, mas não consta o banco
`atrio-qa-broadcast-fixture-only` nem o Worker
`atrio-qa-broadcast-cloud-internal`. A presença de recursos de
homologação **dentro da mesma conta** não demonstra separação de conta
ou de privilégios administrativos. Nenhuma identidade de conta,
identificador D1, segredo ou outro dado privado foi copiado ao código.
Não foi feito provisionamento, deploy, gravação D1 nem modificação de
recursos Cloudflare.

O script de segurança `cloudflare/privacy-batch-stage/scripts/preflight.mjs`
adiciona `assessQaCloudflareIsolation`, uma avaliação **puramente local**
de inventários previamente consultados. Ela recusa a própria conta
operacional, inventário de Workers/D1 ausente, recursos operacionais
encontrados na conta candidata e colisão de nomes. Mesmo quando um
inventário sintético representa uma conta limpa e independente,
`provisioningAuthorized=false` e `deployAuthorized=false` continuam
fixos; a função **não concede permissões**.

Foi corrigida uma condição de corrida no Worker candidato:
`/v1/release` anteriormente podia recolocar um job em `ready`
quando seu estado era `processing`, mesmo entre duas reservas de
destinatário (instante sem registro `inflight`). Isso podia liberar
um segundo Worker enquanto o primeiro ainda estava executando.
Agora a liberação exige `state='halted'`, além da ausência de
tickets `ambiguous` ou `inflight`. Um job órfão em `processing`
permanece bloqueado: sem um protocolo de lease com época/fencing token
e prova de término do executor original, **não é seguro reativá-lo**.
A retomada automatizada de jobs órfãos segue pendente.

A nova cobertura direcionada confirma que uma conta única não atende
aos critérios de isolamento, que uma candidata sem inventário não é
liberada, e que uma tentativa de liberar um lease `processing`
falha sem permitir reenvios. Sem tocar na `main`, backups,
produções, status dos requisitos Play ou gatilhos de publicação.

## Barreira de execução por geração e token em lotes D1 de QA (02/11/2026)

Em `cloudflare/privacy-batch-stage`, cada aquisição atômica de
`ready -> processing` recebe um **UUID novo de execução** e incrementa
`lease_generation` no banco. Ambos ficam associados ao job de teste.
A reivindicação de cada destinatário (`queued -> inflight`) e a
confirmação simulada (`inflight -> acked/ambiguous`) exigem, na **mesma
operação SQL**, que o job ainda esteja em `processing` com o token
daquela execução. Atualizações sem posse atual são negadas e nunca
forçam a conclusão do ticket. Encerrar ou interromper um lote exige
o token correto e limpa o token registrado.

Também ficou vedado reconciliar um ticket `queued` com evidência
`qa-reviewed-never-started` **enquanto o job estiver em
`processing`**. A verificação ocorre no próprio `UPDATE` para
resistir à disputa com outro Worker. Um encerramento prematuro poderia
liberar o congelamento de conta enquanto um emissor ativo ainda
estivesse prestes a reclamar o destinatário.

Os testes adicionais introduzem uma troca de token sintética **entre
a aquisição da execução e a reserva de destinatário**, e outra
**entre a reserva e o registro do resultado**, verificando que nenhuma
execução antiga consegue prosseguir. Há teste separado para recusar
a reconciliação de pendências `queued` durante execução ativa.

**Limite importante:** um token de geração impede escrita tardia após
troca de posse, mas *não comprova que um efeito FCM externo foi
interrompido*. O job órfão em `processing` permanece bloqueado,
sem retomada automática, até existir um protocolo adicional com prova
independente de quiescência. O sistema simula estados; não envia
notificações reais e não assegura publicação Play.

A Cloudflare conectada continua exibindo somente uma conta, misturando
recursos operacionais e de QA; isso **não satisfaz o isolamento
necessário**. Sem criar conta, D1, Worker, segredos ou deploy;
sem alterações da `main`, produção ou backups.

## Quarentena auditável de execução órfã — QA sintético (02/11/2026)

A PR #71 adiciona ao Worker candidato `/v1/quarantine`, reservado
exclusivamente ao papel HMAC de **reconciliador**. O pedido precisa
conter o identificador `qa-broadcast-...`, o UUID do lease observado,
a geração inteira correspondente e a evidência fictícia exata
`qa-fixture-executor-stopped`. O banco só aceita a transição
`processing -> halted` se **estado, token e geração** ainda forem
iguais aos valores observados. Quarentenas atrasadas, repetidas,
forjadas ou contra execução já substituída são negadas.

A transição limpa o token do job, impedindo que o executor antigo
reivindique novos destinatários ou confirme uma operação por SQL.
Um gatilho de SQLite/D1 registra atomicamente o token anterior, geração
e marcador de evidência em `qa_bcast_quarantine_audit`; o histórico
permanece mesmo depois que um job apto a continuar recebe outro lease.

A quarentena **não limpa** tickets `inflight`, não libera congelamento
de conta e **não reinicia** comunicados. Um efeito `inflight` só
pode ser encerrado com a nova evidência sintética e separada
`qa-reviewed-inflight-fixture-only`, cuja operação SQL exige que
o job esteja `halted` e exista registro de auditoria para a
**mesma geração**. `/v1/release` continua negado enquanto existir
qualquer `inflight` ou `ambiguous`. A conta só passa a `frozen`
quando todos os tickets relacionados tiverem conciliação independente.

Testes dirigidos verificam escopo da função, token e geração
incorretos, replay, auditoria persistente, retomada após revisão e
reabertura da conexão D1 simulada, suspensão de destinatário e recusa
de confirmação tardia por execução antiga. A evidência aceita é
**apenas uma declaração para o universo sem rede de nove identidades
fictícias**; não constitui prova de que um Worker real parou, de
que uma mensagem FCM não saiu ou de que houve entrega ao aparelho.
Para o sistema real serão indispensáveis verificação independente de
quiescência, controle de IAM e observabilidade operacional, além do
ambiente Cloudflare separado. Nenhum retry/release automático foi
habilitado e nenhum requisito Play foi marcado como `verified:true`.

Sem provisionamento, deploy, assinatura, merge, alteração da
`main`, produção ou backups.
