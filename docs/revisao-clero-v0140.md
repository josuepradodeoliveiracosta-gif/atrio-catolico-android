# Átrio Católico 0.14.0 — Painel de verificação de selos

## Fluxo
1. O usuário autenticado abre **Perfil > Selos da comunidade** e solicita Padre ou Diácono.
2. O pedido é criado em `badge_requests/{uid}`, com `kind=padre|diacono`, `status=pending` e `createdAt` do servidor.
3. Um administrador com `admins/{adminUid}.enabled=true` acessa **Perfil > Administração — solicitações de selos**.
4. O administrador consulta a lista pendente; a identidade e condição de ministro ordenado **devem ser verificadas por fonte eclesial independente**. Apenas o nome do perfil, fotografias ou autodeclaração não comprovam a ordenação.
5. Após verificação, o revisor marca a confirmação, escreve justificativa de 10–300 caracteres sem dados sensíveis e aprova.
6. Uma única operação atômica no Firebase: `badge_requests/{uid}` recebe `status=approved`, `reviewedBy`, `reviewedAt` e `reviewNote`; `badges/{uid}.clergy` recebe exatamente o cargo solicitado.
7. Para rejeitar, o administrador registra justificativa, muda status para `rejected` e **não** concede selo.
8. O usuário acompanha o status no perfil e pode reapresentar pedido rejeitado.

## Segurança
- A autorização depende exclusivamente das regras de servidor Firestore, não da visibilidade do botão.
- A consulta da fila é permitida somente a administradores ativos; usuários não podem listar pedidos nem ler pedidos alheios.
- O solicitante não pode definir `clergy`, conceder a si mesmo o selo, selecionar Moderador ou aprovar pedidos.
- A aprovação só funciona se o pedido estava pendente e a concessão ao cargo correto ocorrer no mesmo batch. A operação é rejeitada inteiramente se houver conflito ou revogação.
- O selo visual Moderador **não dá privilégios**. A única base para a função administrativa é o documento `admins/{uid}` com `enabled=true`, provisionado via Console/Admin SDK.
- O UID aparece no painel para permitir identificação no Firebase Authentication. Perfis privados não são expostos.
- As regras proíbem alterações posteriores por cliente em pedidos com decisão final, exceto reapresentação permitida após recusa.
- Esta funcionalidade não usa Cloud Functions e não exige mudança para um plano pago.

## Publicação segura — ordem obrigatória
1. Os testes de Firestore no emulador e a compilação Android devem passar.
2. Preservar backup das regras atualmente publicadas no projeto Firebase `atrio-catolico`.
3. Revisar o diff de `firestore.rules` com a versão de produção e **obter autorização explícita antes de implantar novas regras de produção**. Não implantar automaticamente por GitHub Actions.
4. Publicar apenas as regras atualizadas pelo Firebase CLI autenticado, validar resultado no Console e não usar versão antiga dos arquivos.
5. Somente então integrar a branch na principal, compilar o APK release com a chave permanente e distribuir a atualização.
6. Testar com usuário solicitante, administrador ativo, administrador revogado e usuário comum.

## Limitações de operação
- O app não verifica automaticamente a ordenação do solicitante; essa confirmação é responsabilidade administrativa externa.
- A fila exibe o UID, tipo e status; e-mail e cadastro privado de terceiros não ficam disponíveis por leitura cliente.
- O histórico da revisão concluída fica no pedido; reapresentações podem reutilizar o mesmo documento, portanto não equivalem a um log histórico imutável de todas as tentativas.
- Nenhum documento real é usado nos testes automatizados.
