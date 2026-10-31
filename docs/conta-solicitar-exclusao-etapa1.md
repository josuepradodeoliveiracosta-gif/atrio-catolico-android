# Átrio Católico — Solicitação de exclusão de conta (etapa inicial)

Preparado em 31/10/2026 para responder à issue #72 da preparação da Google Play.

**Estado: implementação em PR rascunho, ainda não pronta para uso em produção.**
Esta proposta NÃO apaga contas, senhas, mensagens, discussões, perfis ou fotos.

## Implementado nesta etapa

- Painel em Perfil → Conta e privacidade → **Solicitar exclusão de conta**.
- Mostra aviso e confirmação explícita de que o pedido será somente registrado.
- Registra uma única solicitação em `account_deletion_requests/{uid}` com exatamente:
  - `status: requested`;
  - `source: android`;
  - `requestedAt: serverTimestamp()`.
- Não envia e-mail, CPF, token ou motivo livre no documento. A identidade já está ligada ao UID da conta autenticada.
- Consulta a solicitação do próprio titular e informa quando existe. Erros de rede não são confundidos com exclusão concluída.
- Regras Firestore: somente o titular autenticado pode criar uma vez e ler; não permite listagem, alteração ou exclusão pelo aplicativo. A administração usará um serviço privilegiado próprio para processar o pedido.
- Testes no emulador Firestore de anonimato, isolamento de contas, injeção de campos, falsificação de data, repetição e escrita proibida. Sem acesso a dados reais.

## Bloqueios obrigatórios ANTES de mesclar ou liberar a usuários

1. Implementar backend administrativo para processar a exclusão de forma idempotente, com auditoria mínima, autenticação adequada, retenção justificável e tratamento de erros parciais.
2. Inventariar dados de `profiles`, `public_profiles`, `users/{uid}` e subcoleções, posts/replies, notificações, Firebase Auth, FCM, fotos Cloudinary e registros de moderação. Considerar conteúdo compartilhado com terceiros.
3. Implementar página HTTPS acessível sem o aplicativo com **solicitação verificada** pelo próprio titular, acompanhamento e aviso de privacidade. **Não existe URL pública configurada nesta etapa**; não inserir página fictícia no Play Console.
4. Revisar o fluxo de status do pedido: a criação é confirmação de recebimento pelo Firestore, **não** de tratamento nem de conclusão. Definir responsáveis, prazos e canal de retorno ao titular.
5. Validar duas contas fictícias no emulador e fluxo end-to-end do backend (simulando execução, sem apagar contas reais).
6. Configurar política de privacidade publicada e todos os campos exigidos no Play Console, inclusive URL de exclusão de conta.
7. Fazer rollout apenas quando o serviço processador estiver operacional e supervisionado, sem emitir falsos avisos de conformidade.

## Detalhes de segurança

O documento não pode ser editado nem removido pelo cliente após sua criação. Só o Admin SDK de um backend confiável poderá avançar status e processar dados.
O acesso via Firebase Auth a um usuário existente basta para registrar a intenção, mas a operação definitiva de exclusão deverá exigir controles adicionais e avaliar reautenticação conforme risco.
O Firestore não remove automaticamente subcoleções quando se exclui o documento pai. Uma rotina administrativa deve tratá-las explicitamente.
Não criar limpeza de contas de produção dentro de workflows GitHub Actions.

## Referência

Requisito da Play para aplicativos que permitem criar contas:
https://support.google.com/googleplay/android-developer/answer/13327111

Issue de acompanhamento:
https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/72
