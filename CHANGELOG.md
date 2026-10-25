# Registro de versões — Átrio Católico

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
