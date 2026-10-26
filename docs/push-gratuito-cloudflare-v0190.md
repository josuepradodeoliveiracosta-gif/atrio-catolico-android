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
