# Simplificação controlada — homologação funcional de Conversas (#461)

Escopo autorizado: exclusivamente atrio-catolico-qa-general, Alice e Bob fictícios. Manter autenticação e e-mails verificados, elegibilidade 18+ vigente em ambas as pontas, configuração da rodada, consentimento do destinatário, bloqueio bilateral, transações, quota, autoria e integridade de mensagens. Documentos de Push e restauração continuam privados; não liberar listagem global de chats. A fronteira gerenciada existente, se presente, continua fechando as escritas legadas.

O candidato offline `simple-direct-rules.mjs` combina a captura publicada já fixada por hash com o fragmento direto versionado e fixado por blob. Não inclui grupos nem índice gerenciado. Preserva o acesso às evidências de moderação publicado; o novo relato usa o contrato de autoria existente e não concede novas leituras. A moderação por caso e a migração definitiva são etapas posteriores. Não usar em produção.

## Marcos de progresso (cada um vale 1/8)

- [x] Delimitar escopo, invariantes e congelar base publicada.
- [x] Compor candidato funcional restrito e escrever testes.
- [ ] Validar pedido, aceite, envio, revogação e negativas no emulador.
- [ ] Preparar APK/Worker e verificar o caminho de emissão real; D1, Auth/IAM e publicação da pendência.
- [ ] Aprovar e aplicar composição QA com rollback e conferência da release.
- [ ] Restaurar 18+ por autorização de uso único; readmitir ambas as contas sem expiração da admissão e desativar operador temporário.
- [ ] Registrar dispositivos e confirmar conversa no Android real.
- [ ] Confirmar FCM aceito, chegada, aviso, toque e negativos de sessão, permissão e bloqueio.

A composição não altera firebase.json, não faz deploy e não substitui a autorização de publicação. A janela de revisão 18+ permanece finita; admissão permanente não elimina esse controle. Sem prova de entrega real até a última etapa. A barra é por marcos, não por tempo ou linhas de código.