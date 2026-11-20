# Átrio Conversas — revisão de UI/UX do Chat 3 (18/11/2026)

**Base auditada:** `main@01506b0d2188314546b0cb76b4471902137bd7a2`. **Branch isolada:** `feat/chat3-conversas-ux-privacidade-20261118`.
**Responsável:** Chat 3 — UI/UX e Design. **Destino:** Chat 5 (testes), Chat 7 (revisão), Chat 1 (coordenação).
**Escopo:** telas, contraste, estados e privacidade; não habilita serviço, não altera Firestore Rules, Worker, cadastro/idade, produção, dados reais ou notificações de rede.

## Critérios observáveis e leitura do código

| Fluxo | Situação na base | Aceite automatizado pendente |
| --- | --- | --- |
| Conversas privadas | Lista, solicitações, arquivadas, edição e bloqueio existem em `AtrioConversations.kt` | Mensagem vazia **não** deve aparecer após falha; reconexão deve retirar erro antigo e evitar duplicar envio |
| Solicitações | Aba e estado de solicitação pendente existentes | Aceite/recusa, falha de permissão e troca de conta sem visualização indevida |
| Bloqueios bilaterais | Thread lê apenas os próprios bloqueios; o servidor decide autorização | Retirada imediata de conteúdo e ações após bloqueio de qualquer lado; reaproveitar testes da #346 |
| Denúncias | Há diálogo e feedback na DM, e denúncia de mensagem de grupo | Negativas, erro de rede, privacidade do conteúdo reportado e prevenção de duplo envio |
| Grupos | Criar, convite, recusa, saída e grupo encerrado presentes em `AtrioGroups.kt` | Saída de participante/admin, encerramento, perda de elegibilidade e negação de leitura |
| Sem conexão/reconexão | A tela de DM tem indicador “Aguardando servidor”; a lista pode mostrar erro e estado vazio simultaneamente | Estado de carregamento/erro/vazio mutuamente exclusivos, reenvio único e retorno da conectividade |
| Mensagens removidas | DM troca texto por “[Mensagem removida]” | Nenhum texto original, reação ou ação de edição reaparece após remoção ou troca de conta |
| Avisos | Central `NotificationCenter.kt` distingue discussão de DM e tem avisos locais | Offline/cache, erros e retentativa anunciados de forma acessível; metadados administrativos nunca provenientes apenas de cache |

**Achado confirmado em revisão de código:** `AtrioConversationsScreen.updateInbox` define erro em falha, mas não o limpa em sucesso; com `loaded=true` e lista vazia, o código também apresenta “Nenhuma conversa”. Isso permite uma mensagem de vazio enganosa depois de erro. **Não foi corrigido nesta branch**, pois `AtrioConversations.kt` consta das alterações ainda propostas na PR #232. Encaminhar ao agente que controla a integração da tela; confirmar com regressão em emulador antes do aceite integral.

## Melhorias independentes implementadas nesta branch

1. Na central de avisos, “abrir a discussão” substitui “abrir a conversa” para respostas do fórum, evitando confusão com DM. O texto de ator é filtrado de caracteres de controle e limitado a 60 caracteres.
2. Avisos lidos de cache anunciam estado offline e não confirmam falsamente uma lista atual. Em erro, o botão “Tentar novamente” é acessível, com área mínima de 48 dp e anúncio por leitor de tela.
3. Avisos administrativos exigem sessão correta e snapshot de servidor sem escritas pendentes. Cache nunca autoriza exibir pendências administrativas. Troca de sessão impede leitura/remoção de avisos da conta anterior.
4. `rememberBlockedMembers` remove a assinatura privada ao trocar de conta e não entrega estado de bloqueio pertencente a outra sessão. Falha transitória não apaga o conjunto já conhecido.
5. Testes JVM de política e instrumentação Compose (fonte 200% e offline/erro) foram adicionados nas suítes existentes, sem alterar scripts de CI do Chat 5.

## Concorrência, limites e QA

- **PR #349 / Chat 5:** altera `AtrioConversasCompostasEmulatorUiTest.kt`, `AtrioConversasNavegacaoEmulatorUiTest.kt`, scripts da matriz e fixtures. Nenhum desses arquivos foi editado aqui.
- **PR #232:** inclui `AtrioConversations.kt`, `AtrioGroups.kt` e outros contratos de QA/idade. Nenhum desses arquivos foi editado aqui. A PR continua candidata em rascunho e não deve ser aplicada incidentalmente.
- **Chat 6:** responsável por entrega/recebimento de FCM; esta mudança **não** comprova que avisos de DM/grupo chegam ao aparelho. A central de avisos do fórum não deve ser confundida com entrega de push privado.
- **Chat 5:** conferir exatamente o SHA e a variante `qaGeral` no Firestore Emulator `demo-atrio-v11`, incluindo a matriz Clara/Miguel/Lúcia e os dois testes de acessibilidade, sem editar em paralelo os mesmos arquivos.
- **Chat 7:** revisar diffs, neutralidade dos textos, privacidade na troca de sessão, comportamento offline, colisões de PRs e riscos de composição com a `main`.

**Critério de conclusão:** não declarar “homologação integral” até que as lacunas das transições privadas e o CI completo com os três bots estejam demonstrados em commit compatível. Teste físico é opcional para QA segundo o Prompt Supremo 3.1, não equivalente à comprovação de entrega FCM. Merge, deploy, produção e backups exigem autorizações específicas.
