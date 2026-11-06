# Perfil e apoio ao desenvolvedor — proposta em revisão

Implementação na branch `feature/perfil-apoio-vinho-dourado-20261106`, baseada em `main` (77dd0f8078693420e735035d16a0254743a70aee).

## Escopo
- Cabeçalho vinho/dourado, navegação, cartões e ornamento vetorial.
- Participação, notificações e conta/privacidade preservadas.
- Apoie o desenvolvedor: acordeão fechado por padrão, aberto por toque.
- Não exibir o texto "Somente Fundador Administrador".
- Editar informações exclusivamente na conta oficial do Fundador com administração ativa.
- Dados Pix e bancários só aparecem após publicação real; nenhuma informação fictícia é usada como pagamento.

## Segurança
Configuração em `app_config/developer_support`. Firestore Rules valida simultaneamente o UID da configuração oficial do fundador e a autorização de administrador ativo. Outros membros podem ler, mas não gravar. Não é permitido enumerar documentos, excluir ou acrescentar campos desconhecidos. Desativar a divulgação apaga os dados financeiros publicados.

## Homologação pendente
1. Executar testes de regras no emulador Firebase, sem conexão com produção.
2. Compilar Debug e executar os testes unitários e Compose.
3. Testar fontes ampliadas, TalkBack, conta comum e fundador.
4. Conferir login/logout, notificações, selos, Guardião, publicações e atualizações.
5. Obter autorização separada antes de implantar regras em produção.
6. Obter aprovação antes de integrar na main, assinar ou distribuir o APK.

Nenhum backup, Firebase/Cloudflare de produção, certificado de assinatura ou release foi alterado. A arte está aproximada em componentes nativos e requer validação visual antes da entrega.
