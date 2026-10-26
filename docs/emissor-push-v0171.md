# Planejamento do emissor de notificações push (após Átrio 0.17.0)

## Resultado desta etapa
Foi criada a biblioteca de seleção de eventos em `scripts/push-worker/events.mjs`
e a suíte de testes `scripts/push-worker/events.test.mjs`.
**Não existe nesta ramificação um serviço com credenciais que envie FCM
automaticamente**. A execução privilegiada do emissor precisa ser aprovada e
configurada em ambiente seguro. Não há job agendado nem alteração em produção.

## Eventos e destinatários
1. Resposta: `users/{destinatario}/notifications/{replyId}`, somente se ainda não lida.
   A criação é autenticada e conferida nas regras Firestore existentes.
2. Verificação: alteração de `badge_requests/{uid}` para `approved` ou
   `rejected`, com data de revisão e somente para o titular.
3. Administração (selos): novo pedido `badge_requests/{uid}` pendente,
   apenas para administradores que continuem ativos em `admins/{uid}`.
   O solicitante NÃO deve receber aviso administrativo sobre o próprio pedido.
4. Administração (denúncias): novo documento pendente em `reports`,
   somente para administradores ativos.
5. Nunca usar nome, texto, e-mail, senha, anexo ou justificativa administrativa
   no payload. O cliente recebe só o UID do destino e tipo permitido.
   A verificação do usuário autenticado continua no Android.

## Requisitos obrigatórios para serviço futuro
- Execução fora do APK usando identidade de serviço de privilégio mínimo.
- Credenciais protegidas por segredo de CI ou federação de identidade; nunca
  no Git, no APK ou no chat.
- Verificar destinatário, status e privilégios no servidor antes de enviar.
- Marcar o identificador de cada evento/destinatário com hash SHA-256 em coleção
  administrativa privada para reduzir notificações duplicadas.
- Aplicar transação para reivindicar evento, prazo de lease, limite de tentativas,
  expiração, controle de concorrência, retry seguro e limpeza de tokens inválidos.
- Limites estritos de leituras, destinatários, tokens, frequência e custo.
- Falhar de forma segura quando não há índices, permissões ou quotas.
- Auditar manualmente a versão instalada e testar envio/recepção com app em
  primeiro plano, segundo plano e removido da lista de tarefas.
- Notificações push são entrega por melhor esforço; Android pode atrasar ou
  impedir mensagens, especialmente após encerramento forçado ou economia de bateria.

## Índice do Firestore necessário para consulta eficiente
A consulta escalável a todas as subcoleções `users/{uid}/notifications` por
`createdAt` exige índice com ESCOPO `COLLECTION_GROUP` para essa coleção/campo.
Índices com escopo de coleção não atendem à consulta de grupo. Configurar e
validar sem substituir índices existentes. Índices e regras de produção
somente podem ser modificados com aprovação explícita do proprietário.

## Alternativas e custos
**Cloud Functions:** precisa habilitar faturamento Blaze. Não autorizado.
**GitHub Actions:** pode executar serviço agendado sem manter servidor próprio,
mas não é tempo real. Em repositórios privados há franquia de minutos;
uso excedente pode gerar cobrança conforme a conta. Agendamentos podem sofrer
atraso ou deixar de executar sob carga. Não ativar agendamento ou guardar chave
até o proprietário confirmar o orçamento/quota e o modelo de autenticação.
**Firebase Cloud Messaging:** transporte de mensagens sem custo, mas não é
o gerador de eventos nem substitui servidor.
**Envio de teste pelo Firebase Console:** permite validar recepção, mas não
atende ao requisito de avisos individuais automáticos.

## Segurança operacional
- Nenhuma credencial de Service Account foi criada, pedida, armazenada ou usada.
- Não copiar arquivo JSON com chave privada no chat, em issues, commits ou PR.
- Preferir federação de identidade do GitHub se compatível com a stack em uso.
- Se optar por segredo do GitHub, usar conta de serviço dedicada de
  menor privilégio, não credenciais administrativas gerais do projeto.
- Desligar workflow em caso de problemas e revogar a identidade temporária.
- A versão 0.17.0 mantém a central de notificações DENTRO do aplicativo
  independentemente de servidor push.

## Próximo passo após a revisão de implementação
Escolher o executor autorizado (GitHub Actions com quota ou servidor próprio),
o modelo de autenticação e os índices. Desenvolver e testar o serviço emissor
com dados fictícios; só então configurar credenciais em interface segura,
habilitar sua execução e testar com contas reais que optaram pelo push.
