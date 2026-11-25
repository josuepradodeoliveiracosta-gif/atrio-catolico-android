# Simplificação controlada — homologação funcional de Conversas (#461)

Escopo autorizado: exclusivamente atrio-catolico-qa-general, Alice e Bob fictícios. Manter autenticação e e-mails verificados, elegibilidade 18+ vigente em ambas as pontas, configuração da rodada, consentimento do destinatário, bloqueio bilateral, transações, quota, autoria e integridade de mensagens. Documentos de Push e restauração continuam privados; não liberar listagem global de chats. A fronteira gerenciada existente, se presente, continua fechando as escritas legadas.

O candidato offline `simple-direct-rules.mjs` combina a captura publicada já fixada por hash com o fragmento direto versionado e fixado por blob. Não inclui grupos nem índice gerenciado. Preserva o acesso às evidências de moderação publicado; o novo relato usa o contrato de autoria existente e não concede novas leituras. A moderação por caso e a migração definitiva são etapas posteriores. Não usar em produção.

## Marcos de progresso (cada um vale 1/8)

- [x] Delimitar escopo, invariantes e congelar base publicada.
- [x] Compor candidato funcional restrito e escrever testes.
- [x] Validar pedido, aceite, envio, revogação e negativas no emulador (b37de7e, run 45680297178; alterações posteriores exigem revalidação).
- [ ] Preparar APK/Worker e verificar o caminho de emissão real; D1, Auth/IAM e publicação da pendência.
- [ ] Aprovar e aplicar composição QA com rollback e conferência da release.
- [ ] Restaurar 18+ por autorização de uso único; readmitir ambas as contas sem expiração da admissão e desativar operador temporário.
- [ ] Registrar dispositivos e confirmar conversa no Android real.
- [ ] Confirmar FCM aceito, chegada, aviso, toque e negativos de sessão, permissão e bloqueio.

A composição não altera firebase.json, não faz deploy e não substitui a autorização de publicação. A janela de revisão 18+ permanece finita; admissão permanente não elimina esse controle. Sem prova de entrega real até a última etapa. A barra é por marcos, não por tempo ou linhas de código.

Candidato Android: modo direto exige `qaSimpleDirectEnabled: true` na configuração publicada, identidade QA física exata e ausência da descoberta gerenciada. Consulta somente o documento canônico, com Source.SERVER; preferências por documento, sem listagem geral. A flag vem ausente/fechada por padrão. Não ativar antes de revalidar as Rules e o APK. A publicação da pendência e emissão FCM continuam etapas distintas.

### Primeiro disparo real (assistido)

A primeira rodada mantém a publicação administrativa da pendência, com o serviço `createAuthenticatedConversationPushAdmin` existente. Depois de uma mensagem nova confirmada pelo Android e posterior a ambas as admissões, o operador publica a pendência para o ID canônico; o remetente aciona **Testar Push QA da última mensagem** no APK. O botão só aparece no par físico QA autorizado, com a última mensagem própria confirmada, em conversa aceita. O POST usa o ID token do remetente e envia somente tipo e IDs; nunca texto ou credenciais administrativas. O Worker ainda revalida as condições e reserva D1. `accepted_by_fcm` não comprova recepção. Não se trata de Push automático; automatizar a publicação exige etapa posterior com autorização e revalidação de IAM. Não ampliar escrita IAM do Worker para acelerar o piloto.


### Pré-voo administrativo local

Em checkout isolado com `npm ci` de `tests/security`, `node qa-simple-direct-admin.mjs prepare /root/atrio-qa-candidate` gera regras candidatas, rollback, manifesto e SQL D1 localmente (diretório novo); `node qa-simple-direct-admin.mjs preflight` consulta apenas QA, não publica. A identidade D1 deve ser validada antes de aplicar SQL; nenhum outro banco. O operador desativado precisa coincidir com o e-mail verificado da credencial ADC. O modo `restore`/`publish <messageId>` só é elegível após ruleset candidato publicado, flag explícita e ausência de fronteira gerenciada/bloqueios. Requer autorização operacional da rodada. A restauração usa revisão de 24 horas (janela autorizada), readmissão sem expiração e compensação das alterações identificadas se falhar. O modo publish usa aviso de até 2 min. O operador recebe senha aleatória em memória e capacidades mínimas, autenticação Firebase real, sem exposição de endpoint, e é desativado, tem claims limpas e sessões revogadas em finally. Se houver interrupção abrupta ou falha de limpeza, não continuar: `node qa-simple-direct-admin.mjs cleanup` com a mesma ADC verificada, depois novo preflight. Não executar escrita antes de validar o executor no emulador e autorizar a implantação. Não logar chaves, tokens ou textos. A leitura direta dos dados exige identidade exata. A publicação do Worker, D1 e Rules é separada.
