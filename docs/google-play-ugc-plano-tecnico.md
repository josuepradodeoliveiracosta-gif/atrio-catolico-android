# Átrio Católico — implementação UGC para homologação da Play

**Proposta técnica de implementação; não comprova conformidade nem libera assinatura.**
31/10/2026 · Integrar de forma incremental nas branches existentes, sem PR adicional.

## Resultado da leitura do código existente

- `app/src/main/java/br/com/atriocatolico/MainActivity.kt`: já há ações “Denunciar discussão” e “Denunciar” nas respostas.
- `OnlineAtrioApp.kt`: formulários de denúncias de discussões/respostas e gravação em `reports`; fluxo de envio de post `publish`, resposta e entrada da tela `Tab.PUBLISH`.
- `ModerationScreen.kt`: fila de denúncias e decisões de revisão administrativa.
- `PublicMemberProfile.kt`: perfil público de terceiros, caminho natural para denunciar ou bloquear usuário. Não foi encontrado controle de bloqueio nesse arquivo.
- `firestore.rules`: `posts`, `posts/{postId}/replies`, `reports` e subcoleções `users/{uid}/...` têm políticas explícitas; qualquer mudança de dados exige testes no Firestore Emulator.
- **Não comprovado nesta leitura:** aceite de termos antes do primeiro post, denúncia de usuários e bloqueio de outros participantes com efeito real. Não declarar ausentes de todo o projeto sem uma revisão funcional.

## 1. Aceite antes de publicar UGC

- Publicar uma política comunitária versionada, sem endereço/segredo pessoal hardcoded. Identificar contato e conteúdo proibido (ameaças, assédio, material ilegal, spam, divulgação de dados pessoais, sexualização e outros).
- Criar registro **por titular** de aceitação explícita, com versão, `acceptedAt` gerado no servidor e mínimo de dados. Não usar simples `SharedPreferences` como fonte de autorização.
- Firestore Rules devem garantir autoria, versão de política atual, timestamp correto e imutabilidade do aceite da versão. Para atualizar a versão, registrar nova aceitação; nunca permitir que outro UID aceite.
- Impedir **no backend** a criação de post e de resposta sem aceite; fornecer na UI uma tela de Termos e opção “Não aceito” sem publicação. Cobrir outros fluxos UGC, incluindo edição, perfil público e eventuais mídias, conforme inventário real.
- Não retroagir aceites nem alterar contas reais sem migração planejada.

## 2. Denúncia de usuário

- No perfil público (`PublicMemberProfileScreen`), mostrar “Denunciar usuário” com motivo de 5 a 300 caracteres e confirmação.
- Proposta: coleção `user_reports/{reporterUid + '_user_' + targetUid}` com `reporterUid`, `targetUid`, `reason` e `createdAt`. Firestore Rules: identidade obrigatória, não auto-denúncia, campos permitidos, `createdAt == request.time`, somente `create` pelo denunciante e leitura somente pelo administrador habilitado.
- Não armazenar e-mail, senha, CPF ou conteúdo arbitrário de perfil na denúncia. Administradores têm acesso controlado. Não informar ao denunciado a identidade de quem denunciou.
- Integrar a `ModerationScreen` sem ampliar permissões públicas. Exigir confirmação humana antes de remover dados; Guardião automático não deverá simplesmente apagar contas.

## 3. Bloqueio de usuário

- Perfil público: “Bloquear usuário” e, quando aplicável, “Desbloquear”; impedir autobloqueio; identidade tomada do FirebaseAuth atual, nunca de um parâmetro não verificado.
- Proposta: `users/{ownerUid}/blockedMembers/{targetUid}`, com apenas `createdAt`. Regras: somente proprietário pode `get/list/create/delete`, nunca `update`; sem leituras públicas; verificar `targetUid != ownerUid`, ID seguro e `createdAt == request.time`.
- O cliente deve consultar os bloqueados **do servidor** e ocultar publicações, respostas, perfis, recomendações, notificações e conteúdo salvo do bloqueado; tratar mudanças em tempo real, paginadores, contas trocadas e cache offline.
- **Não confundir filtro local com segurança:** `allow list` de `posts` em Firestore Rules não pode ser usado como “filtro” invisível de documentos conforme bloqueio; consultas que potencialmente retornam documentos negados falharão. Se quiser impedir leitura direta, planejar índices/materialização/queries compatíveis, não somente `filter` do Kotlin.
- Regras/backend devem negar pelo menos interações de escrita entre contas bloqueadas, inclusive resposta, menção, inscrição e envio de Push. Push/Guardião/Avatar devem considerar bloqueio antes de efeitos privilegiados; em caso de consulta inconclusiva, não gerar notificação inadequada.
- Definir efeito de bloqueio recíproco: quem bloqueia não recebe mensagens/menções do bloqueado, e vice-versa onde aplicável. Especificar tratamento de mensagens e posts já publicados sem apagar indevidamente histórico de terceiros.

## 4. Testes obrigatórios, antes de marcar `verified:true`

- Conta A aceita versão atual dos Termos e publica; B não aceita e tem `create` de posts/replies rejeitado por Rules. Não permitir forjar aceite, timestamp, versão nem UID.
- A denuncia postagem, resposta e usuário B; não pode ler denúncias feitas por terceiros; B não consegue obter a identidade do denunciante.
- A bloqueia B: verificação em perfil, feed, detalhes, conteúdo salvo, respostas, inscrições, notificações e duas sessões reais. Bloqueio e desbloqueio persistem após login/logout/reinstalação.
- A não consegue bloquear a si mesma nem escrever no documento de bloqueio de B; clientes antigos/sem aceite não conseguem contornar Rules.
- Simular falha, corrida, cache offline, conta trocada e duplicação de denúncias.
- Validar revisão administrativa da denúncia e retorno ao usuário sem expor dados do denunciante.
- Antes do primeiro AAB assinado: registrar evidências verificadas para `terms_accepted_before_ugc`, `report_content_and_users`, `block_users` e `moderation_actions`.
- **Depois de instalar pela faixa fechada:** registrar `closed_track_ugc_e2e`; não inventar evidência antes da Play.


## 5. Notificações e bloqueio: modo individual seguro (implementado na PR #71, não implantado)

O `cloudflare/push-worker/src/index.js` ganhou o modo `PUSH_BLOCK_SAFE_FANOUT_ENABLED='true'`, **desativado por padrão**. Quando o modo está ativo para respostas:
- Não envia `message.topic` para `atrio_thread_*`. Um assinante antigo do tópico pode permanecer inscrito mesmo depois de ser bloqueado.
- Consulta, com a identidade de serviço já usada pelo Worker, `users/{autor}/blockedMembers/{destinatário}` e `users/{destinatário}/blockedMembers/{autor}` antes de preparar avisos internos e FCM individual.
- Se a consulta falhar, aborta sem tratar erro como ausência de bloqueio. Remetente não recebe o próprio aviso.
- Com mais de **cinco destinatários** possíveis, suspende a notificação dessa resposta (`block_safe_capacity_suppressed`) e registra métrica agregada, evitando extrapolar o limite de subrequisições do Workers Free. **Isto não é capacidade final de produto.**
- Preserva o envio administrativo não associado à resposta; seu escopo deve ser revisado separadamente.
- Não altera inscrições em tópicos anteriores nem exclui mensagens já entregues. O modo seguro limita **novos envios pelo Worker** após sua ativação.

Os testes isolados em `cloudflare/push-worker/src/index.test.js` comprovam ausência de tópico em cenário de dois membros, entrega individual permitida, privacidade de bloqueio recíproco, falha segura e limite de capacidade. A suíte do Worker passou no CI; ainda não há evidência de teste num dispositivo real da faixa Play.

**Sequência de ativação, só após aprovação:**
1. Homologar o aplicativo e as Rules com dois UIDs no emulador; confirmar bloqueio no backend e sincronização de sessão.
2. Avaliar a política de produto para discussões com mais de cinco participantes, custo de fan-out/FCM, remediação de eventuais avisos internos antigos e tratamento de concorrência.
3. Implantar em ambiente segregado, com `PUSH_ENABLED='true'` e `PUSH_BLOCK_SAFE_FANOUT_ENABLED='true'`, sem tocar no endpoint de produção; demonstrar que nenhum envio de tópico ocorre.
4. Verificar FCM real: A bloqueia B, B bloqueia A, ambos livres, token legado inscrito em tópico, conta alternada e erro de leitura Firestore. Inspecionar também aviso por resposta direta, menção e moderação.
5. Em eventual corte controlado, desabilitar `PUSH_ENABLED` se o novo modo falhar. **Nunca usar rollback que volte a transmitir tópicos sem filtrar bloqueios.**
6. Só considerar o requisito `block_users` verificado após revisão humana de evidências de frontend, Firestore Rules, backend e notificações reais.

## 6. Restrições de integração

Nenhuma alteração de Firestore Rules de produção ou dos três Workers principais deve ser aplicada automaticamente por uma aprovação de CI. Revisar e ensaiar no emulador com dois UIDs antes de qualquer distribuição. O pacote para Play e o APK OTA compartilham parte do código; avaliar regressões para os dois canais. Não mesclar esta proposta apenas por ser documentação.

Estado das evidências: `docs/google-play-ugc-evidencias.json` permanece com **0/6**; cinco controles obrigatórios antes da assinatura e um E2E somente após a instalação pela faixa fechada. A PR #71 permanece rascunho; a issue #99 continua aberta.

Política oficial: https://support.google.com/googleplay/android-developer/answer/9876937
