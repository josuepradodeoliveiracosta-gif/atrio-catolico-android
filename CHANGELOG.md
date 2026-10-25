# Registro de versões — Átrio Católico

## v0.10.0
- Denúncias de respostas com motivo e identificação exata do alvo.
- Moderação distingue publicações e respostas e mostra contexto da discussão.
- Remoção de resposta preserva a publicação e as outras respostas.
- Proteção contra decisões de clientes antigos sobre denúncias de respostas.
- 61 testes de regras aprovados no emulador local do Firestore.

## v0.9.0
- Moderação em Perfil, restrita a administradores autorizados no Firestore.
- Consulta de denúncias pendentes e analisadas, incluindo denúncias antigas.
- Leitura integral da publicação denunciada.
- Encerramento sem remoção ou remoção confirmada, com justificativa obrigatória.
- Remoção e decisão em transação; rejeita conteúdo alterado após confirmação.
- Registro privado de decisão, administrador e data, sem reedição pelo aplicativo.
- Acesso administrativo provisionado somente pelo Console/Admin SDK autorizado.
- 28 testes de regras aprovados no emulador local do Firestore.

## v0.8.0
- Abertura direta de discussões por ID, inclusive por notificações antigas.
- Texto completo no detalhe da publicação.
- Carregamento progressivo de publicações e respostas em blocos de 30.
- Salvos consultados independentemente do feed, em blocos visíveis de 30.
- Tratamento de carregamento, falha e publicação removida.
- Isolamento de estado por conta e descarte das novas consultas.
- Regras Firestore e dependências mantidas da versão 0.7.

## v0.7.0
- Avisos de respostas dentro do app, com contador de não lidas no sino.
- Gravação atômica de resposta e notificação quando o autor e quem responde são pessoas diferentes.
- Caixa de notificações para abrir discussão, marcar como lida ou dispensar.
- Apresentação (biografia) opcional no próprio perfil, limitada a 180 caracteres.
- Regras Firestore para somente destinatário ler avisos; origem da resposta verificada com getAfter().
- Dados antigos e identificador Firebase mantidos.

## v0.6.0
- Edição e exclusão de conteúdo próprio.
- Regras de autoria no servidor.
