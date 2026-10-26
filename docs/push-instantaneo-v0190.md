# Átrio Católico — push quase instantâneo (proposta 0.19.0)

## Estado da implementação
Este PR adiciona **três Cloud Functions de 2ª geração** para reagir a eventos
da base Firestore. **Não foram publicadas em produção**, pois a implantação
de funções exige que o proprietário aceite o plano **Firebase Blaze**
(faturamento por uso e possibilidade de custos). A conta de faturamento não
é configurada ou modificada pelo código. Até a publicação, a opção de
verificação em segundo plano da versão 0.18.0 continua sendo a alternativa
disponível; não é instantânea.

## Gatilhos
- `onReplyNoticeCreated`: documento novo
  `users/{uid}/notifications/{noticeId}`. Verifica que notificação e
  resposta existem, que a discussão pertence ao destinatário, que a
  resposta foi escrita por outra pessoa e que o aviso segue não lido.
- `onBadgeRequestChanged`: cria/reapresenta solicitação pendente
  em `badge_requests/{uid}` e avisa administradores atuais, exceto o
  solicitante. Na transição de pendente a aprovado/rejeitado avisa o
  titular, sem expor nota ou autor da revisão.
- `onReportCreated`: documento novo `reports/{reportId}`, avisa
  administradores atuais (exceto autor da denúncia) se continua pendente.

O evento é avaliado com dados do servidor, **nunca toma o destinatário de
um campo controlado pelo remetente**, e verifica se a conta ainda possui
um token FCM opt-in registrado pelo aplicativo.

## Entrega
- Região das funções: `southamerica-east1` (mesma região do Firestore).
- Payload **somente data**: `uid` e `kind` (valores `reply`, `review`,
  `admin`). O Android mostra textos genéricos já definidos no aplicativo.
- Android `priority: high`, TTL de 1 hora: tentativa de entrega rápida.
  Não há garantia de entrega imediata; modo economia, falta de internet,
  dispositivo desligado ou app forçado a parar podem bloquear/adiar.
- No máximo 5 tokens recentes por usuário, 30 administradores,
  2 instâncias por função, nenhuma instância permanentemente aquecida.
- Um registro `pushDispatch/{hash}` de controle, inacessível ao cliente,
  impede repetir o envio quando Firestore reentrega um mesmo evento.
  O emissor registra antes de enviar: **não faz repetição automática
  quando há falha**, para evitar duplicação e custos sem controle. Não
  constitui fila durável com garantias de entrega.
- Retorna ao aplicativo já existente; nenhum APK adicional é exigido
  para a primeira etapa, desde que seja usado Android 0.17+ com FCM
  ativado e permissão de notificação concedida.

## Segurança e privacidade
- Nenhuma credencial administrativa é gravada no app/repositório.
  O Firebase provisiona uma identidade da função, sujeita a IAM.
  Revisar privilégios e recomendar conta de serviço dedicada.
- Nenhuma mensagem contém texto da postagem, identidade de usuário,
  justificativa de selo ou conteúdo de denúncia.
- O token FCM privado permanece em
  `users/{uid}/pushDevices/{installationUuid}`; apenas o titular gerencia
  seus tokens via regras Firestore.
- O registro `pushDispatch` é escrito somente pelo servidor por meio do
  Firebase Admin SDK; as regras atuais negam acesso pelo cliente.
- A consulta de administrador usa apenas `admins/{uid}.enabled=true`.
  O próprio solicitante não recebe aviso administrativo de seu pedido.
- Logs mostram apenas contagens e tipos; não devem receber tokens nem
  dados privados.

## Ativação (exige decisão do proprietário antes de executar)
1. No Console Firebase do projeto `atrio-catolico`, consultar o plano
   atual. **Não habilitar Blaze sem consentimento específico de
   faturamento e riscos de custos.**
2. Caso o proprietário aceite Blaze, configurar uma conta de faturamento,
   alertas de orçamento e limites de escalonamento. **Alertas de
   orçamento não são um teto garantido**. A cobrança pode ultrapassar
   a franquia gratuita conforme o uso.
3. Revisar IAM (ideal: identidade de serviço dedicada), volume de eventos,
   volume de leituras e custo por evento. Verificar APIs de Cloud
   Functions, Cloud Run, Eventarc, Artifact Registry e Cloud Build.
4. Confirmar regras atuais do Firebase e backups. O PR não precisa alterar
   `firestore.rules`, os índices existentes, dados pessoais nem os APKs.
5. Fazer merge do PR após testes, puxar código atualizado para o Termux,
   executar `cd functions && npm install && npm test && cd ..` e
   `firebase deploy --only functions --project atrio-catolico` após a
   autorização específica. Não executar `firebase deploy` genérico.
6. No celular, em Perfil → Avisos no celular, ativar FCM e autorizar
   notificações. Conferir `Dispositivo cadastrado`.
7. Com duas contas, responder à discussão da outra e testar em primeiro
   plano, segundo plano e aplicativo fora da tela. Testar pedidos de
   selos e denúncias somente com contas e papéis apropriados.
8. Conferir logs, uso da franquia e custo no Console Firebase. Se houver
   erro ou custo inesperado, desativar as funções de forma planejada.

## Testes e implantação
- `node --test functions/test/events.test.cjs` cobre filtragem de
  destinatários e eventos, transições, tokens e deduplicação.
- `node --check functions/index.js` valida sintaxe da função.
- A integração real depende de Cloud Functions em execução e do app
  Android instalado. **CI não constitui teste ponta a ponta de push**.
- As funções são executadas sob eventos assíncronos: push é por melhor
  esforço, com possível atraso de cold start, rede ou sistema Android.

## Prevenção de custos
O FCM é gratuito como transporte, mas Firestore, processamento de Functions
e recursos associados podem gerar cobrança. `maxInstances:2` e
`minInstances:0` reduzem exposição, mas não garantem custo zero.
O plano Blaze é obrigatório para implantação de Cloud Functions.
