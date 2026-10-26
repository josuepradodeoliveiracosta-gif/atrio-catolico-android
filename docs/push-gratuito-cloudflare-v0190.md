# Átrio Católico 0.19.0 — Notificações push sem plano pago

## Funcionamento
O Android 0.19.0 envia POST /event ao Cloudflare Worker após uma resposta,
denúncia, solicitação ou revisão de selo ser confirmada no Firestore.
O Worker valida Firebase Auth do remetente via accounts:lookup, relê o documento
na API Firestore sob conta de serviço dedicada e envia FCM HTTP v1 ao destinatário,
sem expor conteúdo das publicações. Nenhuma chave privada fica no APK.
Um banco Cloudflare D1 impede envios repetidos por evento e destinatário.

### Eventos suportados
- reply: confirma reply.uid do remetente, dono do post, aviso atômico não lido.
- badge_request: status pending recente, administradores ativos exceto solicitante.
- badge_result: decisão recente por administrador ainda habilitado, só titular.
- report: denúncia pendente recente e remetente legítimo, somente administradores.

Janelas de eventos de 5 minutos; limite inicial de 8 administradores, 3
dispositivos por pessoa. Entrega at-most-once: uma falha pode perder o push.
A central de notificações dentro do app é a fonte oficial permanente.

## Custo
- Firebase FCM gratuito.
- Cloudflare Workers Free (100 mil requisições/dia, 10ms CPU por requisição,
  50 subrequisições; os limites podem impedir envios).
- Cloudflare D1 Free (5 milhões de leituras e 100 mil escritas de linhas por dia,
  5 GB de armazenamento agregado).
- Firestore Spark continua com suas próprias quotas de leitura.
- Não usa Cloud Functions, Blaze nem cartão de crédito.
- Não há garantia de entrega instantânea: rede, Android e Doze podem atrasar.
- Worker por eventos só dispara se o usuário remetente utilizar versão compatível
  e conseguir concluir a chamada HTTP após salvar o evento. Clientes antigos
  e ações manuais pelo Console não disparam push automaticamente.

## Passos de ativação (feitos pelo proprietário em suas contas)
1. Criar conta Cloudflare Workers Free (NÃO converter para plano pago).
2. Instalar Node.js e Wrangler no Termux ou computador, autenticar localmente.
3. Copiar pasta cloudflare/push-worker do branch feature/push-gratuito-cloudflare-v0190.
4. Copiar wrangler.example.toml para wrangler.toml e criar banco D1:
   npx wrangler d1 create atrio-push-delivery
   Inserir o database_id devolvido em wrangler.toml.
5. Aplicar esquema:
   npx wrangler d1 execute atrio-push-delivery --remote --file=schema.sql
6. Criar conta de serviço do Google dedicada ao projeto atrio-catolico, com
   permissões apenas para leitura Firestore e envio de FCM. Não usar chave
   do APK nem chave de uma conta administrativa geral. Revisar IAM antes.
7. Cadastrar FIREBASE_SERVICE_ACCOUNT_JSON como Secret no painel do Worker;
   cadastrar FIREBASE_WEB_API_KEY como variável do Worker.
   NÃO colar as chaves/senhas/tokens nesta conversa ou em GitHub.
8. Executar npx wrangler deploy e conferir URL *.workers.dev. O padrão PUSH_ENABLED=false mantém o envio desligado. Após configurar credenciais e validar o plano Free, habilitar PUSH_ENABLED=true para o teste controlado.
9. Configurar variável do repositório GitHub Actions:
   ATRIO_PUSH_WORKER_URL = URL do Worker (sem /event).
10. Após testes de integração do Worker, finalizar PR e compilar release
    assinado 0.19.0 (versionCode 25), instalando sobre a 0.18.0.
11. Testar resposta entre duas contas, aprovação/rejeição de selo e denúncia
    com destinatário opt-in FCM e o app do destinatário em segundo plano.

## Testes e segurança
- node --test cloudflare/push-worker/src/index.test.js
- CI Android e Firestore continua obrigatório antes do merge.
- Endpoint vazio em BuildConfig significa relay DESATIVADO, sem tentativas
  de webhook. A versão 0.18.0 e o backup protegido permanecem intactos.
- O SDK Android envia apenas ID Token efêmero e identificadores; o Worker
  não permite UID destinatário arbitrário, nem envia o texto do conteúdo.
- A conta de serviço e API key nunca devem ser embutidas no aplicativo.
- Realizar testes de CPU/limites Cloudflare Free em conta real: não verificados.
- Aumentos de público exigem revisão de capacidade e limites.
- O pull request de Cloud Functions/Blaze #14 permanece separado, não ativado.

Referências:
https://developers.cloudflare.com/workers/platform/limits/
https://developers.cloudflare.com/d1/platform/pricing/
https://firebase.google.com/docs/cloud-messaging/send/v1-api
https://firebase.google.com/docs/reference/rest/auth

## Retomada em 26/10/2026
- Cloudflare conectado; Worker `atrio-push` implantado com envio DESATIVADO (`PUSH_ENABLED=false`).
- D1 `atrio-push-delivery` criado e esquema aplicado. Endpoint: https://atrio-push.atrio-catolico.workers.dev.
- `GET /health` indica configuração/desativação; não comprova entrega FCM. `POST /event` recusa envio enquanto desativado.
- Credencial Google e API key ainda não cadastradas; nenhum teste real de entrega FCM realizado.
- A conexão OAuth não permite consultar faturamento. Confirmar Workers Free no painel antes de habilitar tráfego real. Nenhuma assinatura paga foi criada ou alterada.
- Corpo de requisição limitado durante leitura a 512 bytes, inclusive sem Content-Length; JSON inválido recebe 400. Sem configuração/ativação, não acessa Google nem D1.
- Limpeza limitada a 100 marcadores com mais de um dia por evento válido; mantém idempotência dentro da janela de eventos. Falha total do FCM não é reportada como envio aceito.
- 20 testes Node locais aprovados; testes integrados com credenciais e cotas reais continuam pendentes.
- Branch atualizada com orientações AGENTS.md e correções de consulta de versão da main. A principal permanece 0.18.0 até concluir a ativação/teste da 0.19.0.

A conferência HTTP externa neste ambiente retornou 503 de conexão upstream, não a resposta JSON do Worker. A API Cloudflare confirma o subdomínio habilitado; validar /health por outra conexão antes de ativar o envio.

## Continuidade da configuração (26/10/2026)
- Proprietário confirmou pelo painel os planos Cloudflare Workers Free e Firebase Spark.
- Worker `atrio-push` passou a ter `FIREBASE_SERVICE_ACCOUNT_JSON` e `FIREBASE_WEB_API_KEY` cadastradas como `secret_text`, além de `PUSH_DB` D1; `PUSH_ENABLED=false` foi preservado.
- Usuário verificou `GET /health` em seu navegador e recebeu `{"status":"disabled"}`. Isso comprova alcance do endpoint, não o envio de mensagens FCM.
- A integração GitHub conectada não oferece edição de variáveis de Actions nas configurações. Como alternativa funcional, **somente na branch 0.19.0**, os workflows `build-apk.yml` e `selos-ci.yml` usam a URL `https://atrio-push.atrio-catolico.workers.dev` como valor padrão de `ATRIO_PUSH_WORKER_URL`; uma variável GitHub Actions com esse nome, se adicionada futuramente, continua tendo prioridade.
- **Nenhuma variável de Actions foi criada nas configurações** e nenhum APK de produção foi publicado por esta alteração.
- O envio push segue DESATIVADO; ainda faltam testes integrados com contas reais, revisão de segurança das credenciais e aprovação do merge antes da publicação 0.19.0.


## Roteiro seguro de homologação 0.19.0

### Resultado das verificações automatizadas
- Os testes de unidade do relay simulam autenticação Firebase, leitura Firestore, aceitação FCM, rejeição FCM e deduplicação D1, sem consultar Google ou Cloudflare reais.
- A compilação Android, as regras Firestore e a validação de não regressão de versões executam na PR #15.
- A PR disponibiliza opcionalmente o artefato `atrio-catolico-v0190-debug-testes` após CI verde (retenção de sete dias). A compilação *debug* **não** usa a assinatura de produção: não tente instalá-la sobre a versão 0.18.0 assinada. Não desinstale a 0.18.0 no aparelho principal para isso. Use somente aparelho de testes sem instalação prévia ou emulador.
- Esse debug aponta para o Firebase configurado do projeto e, se `PUSH_ENABLED=true`, pode gerar eventos reais: prefira contas específicas de teste. Não crie conteúdo sensível nem publique mensagens reais apenas para validar notificações.

### Antes de habilitar o emissor
1. Revisar armazenamento e rotação das credenciais: a chave da conta de serviço foi inicialmente cadastrada em uma variável comum e posteriormente corrigida para Secret; **rotacionar essa chave antes do lançamento de produção**. Nunca expor o JSON nesta conversa ou no GitHub.
2. Confirmar o plano Cloudflare Workers Free, permissões IAM limitadas e FCM HTTP v1 habilitado.
3. Preparar duas contas de teste A/B e um aparelho de teste com app 0.19.0; destinatário opt-in no painel de avisos, permissão de notificação Android concedida.
4. Conferir `PUSH_DB`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_WEB_API_KEY` e `PUSH_ENABLED=false`, sem visualizar valores secretos.

### Teste real controlado (não realizado)
1. Em janela controlada, alterar `PUSH_ENABLED=true` apenas depois dos pré-requisitos acima. O GET /health passará a informar `configured`, mas **isso não prova entrega FCM**.
2. Conta A publica, conta B responde; A deve receber aviso ao fundo e ao tocar deve abrir o Átrio, sem conteúdo privado no corpo da notificação. Confirmar também notificação persistida na central.
3. Repetir uma resposta/evento com o mesmo identificador e confirmar ausência de entrega duplicada, quando aplicável.
4. Testar pedido de selo e denúncia usando conta de teste, observando o administrador destinatário. Testar decisão de selo sem vazar a identidade do solicitante a terceiros.
5. Desligar o opt-in FCM no destinatário e confirmar ausência de notificação push, mesmo que a verificação periódica continue ativada.
6. Observar quotas e erros do Worker e Firestore; caso qualquer comportamento esteja incorreto, definir `PUSH_ENABLED=false` imediatamente.
7. Somente depois de evidência de entrega real, revisão de segurança e aprovação, finalizar PR #15 e gerar **APK release assinado** com a assinatura permanente e `versionCode 25`, apto a atualizar a versão 0.18.0 sem perder dados locais. Não mesclar durante a homologação.

### Situação atual do envio
O Worker está provisionado e recebe GET /health; as duas credenciais estão cadastradas como Secrets e D1 existe. O envio permanece `PUSH_ENABLED=false`; a entrega real entre usuários ainda está pendente.

## Ativação do Worker para homologação em 26/10/2026
- A pedido expresso do proprietário, `PUSH_ENABLED` foi alterado de `false` para `true` no Worker Cloudflare `atrio-push`, usando PATCH de configuração com herança das demais bindings.
- A API confirmou `PUSH_ENABLED=true`, `PUSH_DB` (D1) e as duas credenciais de serviço/Identity Toolkit como `secret_text`. A origem publicada do Worker foi comparada com `src/index.js` desta PR e coincidiu exatamente antes da ativação.
- Teste dos endpoints a partir do navegador do proprietário e **entrega FCM em aparelho real ainda pendentes**; não confundir `enabled` com `accepted_by_fcm` ou mensagem efetivamente exibida.
- A ativação **não é limitada a contas de teste**: qualquer cliente compatível 0.19.0 com evento autorizado pode solicitar envio para destinatários já cadastrados com opt-in. Os clientes 0.18.0 não disparam este relay.
- Para desativação imediata em incidente, alterar somente `PUSH_ENABLED` para `false`; não remover segredos nem modificar regras Firestore.
- A chave JSON da conta de serviço foi inicialmente exposta como variável comum antes de virar Secret; rotacionar antes do lançamento público. Não mesclar PR #15 nem distribuir release assinado até executar e documentar teste real de duas contas e revisar a segurança.


## Comunicados gerais ao público (implementação em PR #15)

### Modelo e consentimento
- Novo painel **Perfil → Administração → Notificações gerais**, visível apenas se o UID da sessão for o mesmo de `app_config/founder.uid` e a conta estiver cadastrada como `admins/{uid}.enabled=true`.
- O aplicativo 0.19.0 inscreve aparelhos no tópico `atrio_comunicados_v1` quando o usuário ativa o FCM em **Avisos no celular**. O aplicativo cancela a inscrição ao desativar os avisos ou sair da conta; o recebimento local exige novamente que avisos continuem ativos.
- A inscrição no tópico é exclusiva dos clientes compatíveis que fazem opt-in; instalações antigas (inclusive anteriores à mudança da PR) precisam atualizar e voltar a executar o registro/inscrição. FCM não fornece contagem exata de destinatários nem garantia de entrega.
- O tópico é um mecanismo de distribuição, não uma autorização. Permissões de envio estão exclusivamente no Worker.
- Título de 5 a 60 caracteres e mensagem de 10 a 180 caracteres, ambos sem controles/caracteres de direção. O conteúdo geral é apresentado no aviso do próprio Android; não incluir informações privadas.

### Segurança do servidor
- `POST /broadcast` exige `PUSH_ENABLED=true` **e** `BROADCAST_ENABLED=true` (novo kill switch independente, padrão `false`).
- O Worker valida ID token via Firebase Auth, revalida `admins/{uid}.enabled` e o documento `app_config/founder.uid` pelo serviço autenticado, limita o corpo a 512 bytes, valida campos e UUID v4 e recusa ações não autorizadas.
- Cloudflare D1 usa a tabela `delivered` já existente para permitir no máximo uma tentativa geral por hora, de modo atômico, mesmo com solicitações concorrentes. Solicitações repetidas ficam bloqueadas por frequência; uma falha FCM pode consumir a janela de tempo. A operação não garante entrega nem informa destinatários pessoais.
- O Worker usa FCM HTTP v1 para mensagem **data-only** com `topic: atrio_comunicados_v1`, e nunca envia tokens FCM ou chaves para o aplicativo.
- Só exibir ao fundador após confirmação na interface do título/mensagem e informação de irreversibilidade.
- Não será ativado automaticamente no Worker já publicado. Antes de ativar `BROADCAST_ENABLED=true`, validar revisão de segurança, simulação de usuário não fundador e administrador revogado, testes de aparelho, consentimento e aprovação explícita.

### Homologação
1. Conferir os testes Node, regras Firestore, Android e controle de versões da PR #15.
2. Instalar nova compilação 0.19.0 num aparelho de testes; conferir opt-in, inscrição no tópico e cancelamento da inscrição ao desativar.
3. Implantar novo Worker preservando variáveis/secrets e `PUSH_ENABLED`. Manter `BROADCAST_ENABLED=false` inicialmente, confirmar que `POST /broadcast` devolve `broadcast_disabled`.
4. Usar dispositivo do fundador e conta administrativa ativa para validar a interface e rejeição enquanto desabilitado.
5. Habilitar `BROADCAST_ENABLED=true` somente numa janela controlada, preparar texto de teste não sensível e garantir receptores de teste inscritos; avisos gerais atingem todos os inscritos, não existe filtro para duas contas. Se houver risco de usuários externos inscritos, **não executar envio de teste em produção**.
6. Confirmar resposta `accepted_by_fcm` apenas como aceite do FCM e observar aparelhos reais; confirmar frequência e permissão, e desligar de novo caso necessário.

**Estado no repositório**: código preparado em PR #15. O Worker publicado deve continuar sem o endpoint novo até conclusão da homologação. O Worker de push individual pode permanecer ativado independentemente.

## Ativação do endpoint de comunicados gerais em 26/10/2026
- Mediante pedido explícito do proprietário, o novo código de `src/index.js` foi publicado em `atrio-push` via API Cloudflare, com herança estrita dos bindings anteriores e inicialmente `BROADCAST_ENABLED=false`.
- A API confirmou deployment da nova versão em 100% do tráfego, `PUSH_ENABLED=true` (eventos individuais) e depois `BROADCAST_ENABLED=true` (comunicados gerais). As duas credenciais Firebase seguem `secret_text`, o D1 segue vinculado.
- `POST /broadcast` exige usuário autenticado, `admins/{uid}.enabled=true` e `app_config/founder.uid` coincidente, confirma título/mensagem na interface e aplica cooldown atômico no D1 (um comunicado por hora). Chave `BROADCAST_ENABLED` permite desligar somente comunicados gerais, preservando push individual.
- Após ativação, consulta D1 encontrou **zero tentativas de comunicado geral**. **Nenhuma mensagem foi enviada nesta etapa.** Não confundir habilitação do endpoint ou aceite FCM com entrega efetiva ao aparelho.
- Alcance não é literalmente todos os usuários: somente versões do app com inscrição no tópico `atrio_comunicados_v1`, notificações habilitadas e aparelho com FCM funcional podem mostrar o aviso. A 0.18.0 não contém esse mecanismo e precisa de atualização futura.
- Os testes de CI da PR ficaram verdes antes da implantação; teste real de entrega do comunicado a um aparelho permanece pendente. PR #15 continua aberta, sem merge nem release de produção.

## Diagnóstico de falha de recebimento FCM — 26/10/2026

- Relato do proprietário: aparelho não exibiu aviso imediato. Antes desta correção, D1 continha quatro marcadores de eventos do tipo `reply` entre 18:52 e 19:35 UTC. Um marcador demonstra que houve aparelho elegível no momento da tentativa, **não** que o FCM aceitou ou entregou a mensagem. Não havia tentativa `broadcast` no D1.
- Implementada e publicada instrumentação não identificável, usando tabela D1 `push_delivery_stats` agregada por hora, categoria, resultado, código HTTP do FCM, quantidade de tentativas e aceites. Não armazenar UID, chave de evento, token ou conteúdo.
- Worker agora registra `accepted_by_fcm`, `delivery_failed`, `no_devices_or_duplicate` e `ignored` (melhor esforço, sem alterar a entrega caso a auditoria falhe). API Cloudflare confirmou implantação em 100%; `PUSH_ENABLED=true` e `BROADCAST_ENABLED=true` foram preservados.
- O próximo evento novo de resposta, criado por cliente Android 0.19.0 com relay configurado, vai gerar uma linha agregada de telemetria. Confirmar se há aceite HTTP FCM. Mesmo aceite 200 não garante exibição no Android; verificar permissões, dispositivo cadastrado, restrições de bateria e versão no celular recebedor.
- Testes Node do Worker aprovados no GitHub. A modificação é somente de servidor; não é necessário novo APK para que o diagnóstico do próximo evento funcione.

## Limpeza segura de tokens FCM inválidos (26/10/2026)

- Após teste real confirmado pelo proprietário de que o Push chegou com o aplicativo fora da tela, observou-se telemetria agregada com alguns retornos HTTP 404 junto a entregas FCM aceitas.
- O Cloudflare agora reconhece exclusivamente um retorno **HTTP 404** cujo JSON de erro do FCM contenha `error.code=404` e `error.status=UNREGISTERED` **ou** detalhe tipado `google.firebase.fcm.v1.FcmError` com `errorCode=UNREGISTERED` (inclusive quando o status genérico é `NOT_FOUND`). HTTP 404 genérico (`NOT_FOUND`), HTTP 400 (`INVALID_ARGUMENT`), timeouts, erros temporários, de autenticação ou de projeto **não** apagam tokens.
- O Worker obtém a identidade do registro `users/{uid}/pushDevices/{deviceId}` a partir de `name` retornado pelo Firestore, restringindo a rota ao projeto, usuário e dispositivo consultados; exige `updateTime` completo do documento.
- Aplica `DELETE` no Firestore via API REST com precondição `currentDocument.updateTime`; caso uma versão atualizada do mesmo dispositivo tenha sido gravada entre leitura e tentativa de remoção, a exclusão falha e o novo token é preservado.
- Falhas no processo de limpeza não bloqueiam os demais destinatários, não alteram a aceitação do Push e não são expostas ao aplicativo. Contadores anônimos agregados de `cleanup / unregistered_removed` são registrados no D1 quando houver exclusão efetiva.
- Testes automatizados incluem UNREGISTERED, NOT_FOUND, INVALID_ARGUMENT, falha de rede/resposta inválida, falta de metadados e disputa por atualização do cadastro. Nenhum token foi copiado para logs.
- Essa correção altera somente o Worker Cloudflare. A versão Android instalada não precisa ser reinstalada para receber o benefício. A PR #15 segue em homologação e não altera a versão 0.18.0 publicada.
- Referências: https://firebase.google.com/docs/cloud-messaging/manage-tokens ; https://firebase.google.com/docs/cloud-messaging/error-codes ; https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/delete

## Participantes de uma discussão recebem respostas — versão de testes 0.19.0

### Regra funcional
Quando uma resposta é publicada, o criador da discussão **e todos os outros comentaristas identificados nas respostas existentes** recebem um aviso (um por UID), exceto o autor da nova resposta. Se o próprio criador responder, os demais participantes também são avisados. A funcionalidade inclui Central de Avisos (documentos privados `users/{uid}/notifications/{replyId}`) e Push FCM para dispositivos inscritos no tópico daquela discussão.

### Modelo de distribuição no plano gratuito
- O Android chama `InstantPushRelay.reply()` após **toda resposta bem-sucedida**, inclusive do dono.
- O Worker verifica Firebase Auth, lê a resposta recém-criada e o post real no Firestore; se o autor da resposta for diferente do dono, continua verificando a notificação atômica ao dono criada pelo cliente.
- O backend enumera e valida os participantes nas respostas da discussão, removendo duplicados e o remetente, e registra central de notificações através de **uma operação Firestore batchWrite**, com precondição `exists=false` para não sobrescrever avisos lidos ou descartados.
- O Worker envia uma notificação FCM genérica por **tópico `atrio_thread_{postId}`**, em vez de efetuar uma chamada por token de todos os comentaristas. O destinatário Android só exibe se a conta atual estiver cadastrada como participante no dispositivo, se o Push estiver ativado e se não tiver sido o autor da resposta.
- O push **individual legado para o dono da discussão** é preservado para versões anteriores do app. No Android atualizado, um identificador de evento evita aviso duplicado quando tanto o tópico quanto a mensagem individual chegarem.
- O Android inscreve a conta em um tópico quando ela cria um post ou responde. Para participações antigas, também registra quando o usuário reabre um post de sua autoria ou em que suas próprias respostas estejam entre as carregadas. Ao ativar Push, reinscreve os tópicos registrados, e ao sair ou desativar notificações cancela suas inscrições.
- A mensagem por tópico contém somente o identificador público do post/resposta e o UID de quem respondeu; **não contém o texto da discussão, a resposta nem dados de perfil privados**. Usuários que conhecem o identificador do tópico podem tentar se inscrever por conta própria; tópicos não são mecanismo de autorização ou sigilo. O aviso no Android é genérico e exige participação local para exibição.

### Limites e rollout
- Este primeiro fan-out tem limite intencional de **250 destinatários distintos** e **2.000 respostas verificadas** por evento, para respeitar a cota do Cloudflare Workers Free e manter um lote Firestore administrável. Se ultrapassar um limite, o Worker deve falhar com `unavailable` sem notificar um subconjunto silenciosamente; será necessário processamento em lotes/filas para suportar discussões maiores.
- Firestore já autoriza leitura de respostas por usuários autenticados e leitura de notificações apenas ao próprio destinatário; **nenhuma regra de escrita privilegiada para clientes foi adicionada**.
- Push para os demais participantes exige APK novo com inscrição em tópicos. Instalações antigas continuam podendo receber o Push individual para o dono e acessar os avisos novos quando abrirem a Central, desde que a chamada ao Worker seja feita por um cliente compatível.
- A publicação do Worker para o ambiente ativo só deve ocorrer após os testes de Node, compilação Android, segurança Firestore e teste real em duas ou mais contas. **NÃO CONFUNDIR código no PR com publicação em produção ou entrega confirmada no aparelho.**

### Casos testados
- Post criado por Maria; João, Ana e Pedro respondem: Maria, João e Ana recebem quando Pedro responder; Pedro não recebe sua própria mensagem.
- Post criado por Maria; Maria responde: João, Ana e Pedro recebem; Maria não recebe.
- Múltiplas respostas de João produzem somente um aviso por nova resposta, e não um aviso por comentário antigo.
- Central de avisos não sobrescre aviso existente/lido; Firebase tópico envia aviso genérico, com deduplicação local da mensagem individual.
