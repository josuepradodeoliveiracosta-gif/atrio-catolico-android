# Átrio Católico 0.17.0 — preparação para notificações push

## O que esta versão faz
- Adiciona SDK do Firebase Cloud Messaging no Android.
- Mantém a inicialização automática de FCM DESATIVADA até ação voluntária do usuário.
- Em **Perfil > Avisos no celular**, o usuário opta por ativar/desativar o aparelho.
- Solicita permissão `POST_NOTIFICATIONS` somente após a escolha (Android 13+).
- Registra um token FCM associado ao usuário autenticado em
  `users/{uid}/pushDevices/{installationUuid}` com `token` e `updatedAt`.
- Atualiza registro após troca do token FCM e na sessão futura da mesma conta.
- Na saída da conta desativa a preferência local, tenta excluir o registro do servidor e apaga o token local do FCM.
- Receptor de mensagens **data-only** aceita apenas `uid` igual à sessão atual
  e `kind=reply|review|admin`. Título e corpo exibidos são sempre genéricos,
  definidos no código. Não expõem conteúdo de publicações, nomes ou detalhes pessoais.
- A notificação toca e abre o aplicativo; o usuário consulta a central existente.

## LIMITAÇÃO FUNDAMENTAL: ainda não existe envio automático
O SDK do aplicativo **não envia mensagens** FCM. É obrigatório integrar posteriormente
um backend confiável que escute os eventos do Firestore e envie pelo FCM HTTP v1 / Admin SDK.
NUNCA inclua credenciais de administrador, chave privada ou token de acesso de serviço no APK,
no repositório, nos documentos públicos do app ou em regras Firestore.

FCM é gratuito, mas **Cloud Functions exige plano Blaze**, com cobrança conforme utilização.
Esta branch não ativa Blaze, Cloud Functions, Pub/Sub, outros serviços pagos nem altera faturamento.
Uma campanha/manual de teste pelo Console Firebase é possível depois de ativar a recepção.

### Formato futuro do payload somente DATA
Exemplo de estrutura a ser enviado pelo servidor confiável, nunca pelo cliente:
- `data.uid`: UID do destinatário autenticado (não pode ser escolhido pelo remetente)
- `data.kind`: `reply`, `review` ou `admin`
- Outros campos não são exibidos; conteúdo potencialmente sensível deve permanecer no Firestore.

Recomenda-se evitar payload `notification` para avisos personalizados, pois notificações
do sistema em segundo plano podem ser mostradas sem o filtro de UID do `onMessageReceived`.

## Privacidade / proteção de dados
- A coleção `pushDevices` é privada: somente o proprietário autenticado consulta e
  modifica suas instâncias; outros usuários e administradores CLIENTE não podem listar tokens.
- O futuro servidor autorizado deve verificar o destinatário real e os requisitos
  administrativos antes de enviar avisos. Não envie dados pessoais em corpo ou título.
- Um token registrado pelo app não representa identidade, papel administrativo ou
  permissão. Não é uma credencial de login, mas é um endereço de dispositivo e deve
  permanecer privado.
- Exclusão remota e rotação de token ao sair/desativar são tarefas assíncronas: se a
  rede falhar, um registro antigo pode permanecer no Firestore. O backend futuro
  precisará lidar com tokens inválidos, revogação e limpeza de registros órfãos.
- O usuário pode negar permissão; o app continua funcionando sem notificações push.
- Preferência no aparelho é separada por UID e backup do aplicativo permanece desativado.

## Publicação — não ignorar esta ordem
1. Rodar suite de regras no emulador e compile Android.
2. Conferir backup e DIFERENÇA das regras publicadas atualmente.
3. Solicitar autorização EXPRESSA do proprietário para publicar o novo bloco
   `users/{uid}/pushDevices/{installationUuid}` em produção.
4. Implantar via Firebase CLI no projeto `atrio-catolico`, conferir no Console.
5. Apenas depois, integrar branch `feature/push-fcm-optin-v0170` em `main`,
   produzir APK 0.17.0 com mesma assinatura e instalar sem desinstalar.
6. Testar ativar/desativar, permissões Android 13+, sessão/logout e
   token gerado. Teste manual via Console FCM após confirmar a permissão.

## Diferença da central 0.16.0
A central de notificações existente continua operando como antes sem push.
Nenhum evento do Firestore é consumido automaticamente para enviar push nesta versão.
O aplicativo não promete mensagens com app fechado até existir backend emissor.
