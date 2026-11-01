# Google Play — matriz de Segurança dos dados (revisão, não enviar)

**STATUS: NÃO PREENCHER O FORMULÁRIO COMO DEFINITIVO.** Matriz preliminar baseada em fontes do repositório; faltam inspeção da variante `playRelease`, SDKs transitivos, serviços ativos e aprovação do responsável.

| Categoria potencial | Indício de tratamento no código | Finalidade a verificar | Evidência faltante |
|---|---|---|---|
| E-mail e identificador de conta | Firebase Auth, pedido de exclusão | Login, recuperação e controle de conta | Configuração Firebase, retenção e exclusão |
| Nome, biografia e perfil | Telas de perfil / Firestore | Identidade na comunidade | Campos efetivos, visibilidade, retenção |
| Textos criados pelo usuário | Discussões e respostas | Interação na rede social | Lista de coleções, divulgação, anonimização |
| Fotos e identificadores de mídia | Avatar Worker e Cloudinary | Imagem de perfil e moderação | Inventário de imagens, transferências e eliminação |
| Identificadores de dispositivo/token | Push Worker, FCM e inscrições | Notificações | Necessidade, retenção e controle de inscrição |
| Interações sociais | Seguir, salvar, histórico | Personalização da comunidade | Quem acessa, sincronização e exclusão |
| Registros de denúncias e moderação | Guardian Worker, relatórios | Segurança e revisão | Prazo, destinatários e base legal |
| Dados derivados de religião/ministério | Conteúdo e selos públicos | Funcionalidades comunitárias | Revisão de dados sensíveis e controles |
| Pedidos de exclusão e auditoria | Android, portal e executor de QA | Exercício de direitos e segurança | Processo real, retenção e confirmação |

## Preenchimento Play Console: decisões obrigatórias

Para **cada categoria**, confirmar se é coletada, compartilhada, opcional/obrigatória, se há uso temporário, finalidade efetiva, eventual criptografia em trânsito, mecanismo de solicitação de exclusão, segurança e contratos com fornecedores. O preenchimento deve refletir **a versão efetivamente enviada** e seus SDKs, não apenas o código-fonte.

A presença de Firebase, Cloudinary ou Cloudflare não determina sozinha se o formulário deve marcar “compartilhamento”; verificar a definição do Google, os contratos e a prática real. Não marcar “não coleta dados” nem “todos os dados são excluídos” antes de comprovação.

## Diferença entre etapas

1. **Código de QA:** já permite solicitação e testes sintéticos, mas não prova que o serviço público está disponível nem que a conta real é eliminada.
2. **Teste fechado:** é preciso concluir a configuração do app e preencher Segurança dos dados e a Política de Privacidade (conforme políticas Play); não pressupor que o AAB de PR esteja assinado ou publicado.
3. **Produção:** para contas pessoais elegíveis, a regra de testadores inscritos por 14 dias é uma etapa posterior, não substitui a homologação da privacidade.

## Pendente antes de marcar o requisito como verificado

- Identidade e canal de contato do controlador; política pública HTTPS.
- Inventário de SDKs e tráfego do AAB `playRelease`; verificação manual do Play Console.
- Mapeamento de campos Firestore/D1, tokens FCM, imagens e moderação, inclusive prazos.
- Análise de conteúdo religioso e selos de clero sob a LGPD.
- Fluxo real de exclusão seguro, incluindo dados associados em Auth/Firestore/Cloudinary.
- Revisão por responsável identificado e evidência verificável.

Referências: https://support.google.com/googleplay/android-developer/answer/10787469 ; https://support.google.com/googleplay/android-developer/answer/13327111 .
