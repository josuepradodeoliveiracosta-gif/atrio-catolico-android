# Registro de versões — Átrio Católico

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
