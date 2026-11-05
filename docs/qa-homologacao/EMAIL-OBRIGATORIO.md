# Confirmação de e-mail obrigatória — primeiro lançamento oficial

Estado em 05/11/2026: **código de interface preparado para revisão, política produtiva NÃO ativada, nenhum APK Release autorizado**.

## O que já está pronto

- Cadastro via Firebase Authentication (e-mail e senha) envia link de verificação.
- O perfil permite reenviar o link e atualizar a sessão com `reload()` e `getIdToken(true)`.
- As regras do Firestore negam **criação de posts e respostas** se a configuração administrativa está ativa e o token Firebase Authentication não contém `email_verified=true`.
- O aplicativo apresenta uma tela de confirmação antes de entrar na comunidade quando a política está ativa. Ela permite reenvio, conferência e saída da conta.
- **Segurança de entrada (fail-closed):** para contas não verificadas, o aplicativo aguarda a política obtida diretamente do servidor. Cache local, carregamento inicial ou erro de leitura nunca liberam a navegação. Em falha há opção de tentar novamente ou sair; conta com claim autêntico de e-mail confirmado pode entrar.
- A liberação após confirmar usa `reload()`, renovação do token e verificação explícita de `email_verified=true` no token atualizado.
- Os testes de Firestore e Android rodam somente com Firebase Emulator (`demo-atrio-v11`).

**Atenção:** o cliente não é fronteira de segurança; a proteção de gravações depende das regras **efetivamente implantadas** no projeto de produção. Leituras e outras operações não são automaticamente proibidas por esse portão: não confundir com bloqueio integral do Firebase Authentication.

## Configuração administrativa — não ativar sem homologação

Documento Firestore (projeto `atrio-catolico`):
- Coleção: `app_config`
- Documento: `email_verification`
- Campo `enabled` (boolean): `true`
- Campo `version` (string): `2026-11-v1`

Somente Console Firebase ou Admin SDK autorizado pode gravar o documento; o APK não pode alterá-lo. **Configuração ausente, versão inválida ou `enabled=false` desativam a exigência no código atualmente implantado.** Confirmar sempre a versão das regras efetivamente em produção antes da ativação.

## Critérios de aceite após ativação controlada

1. Confirmar que as regras produtivas de posts/respostas contêm a validação por `request.auth.token.email_verified` e que a configuração está ativa.
2. Criar conta de QA com e-mail real não confirmado: a tela de verificação deve aparecer, sem acesso às abas da comunidade.
3. Uma tentativa direta de `create` em `posts` e `posts/{id}/replies` usando token **não verificado** deve receber `PERMISSION_DENIED` — não confiar só no botão oculto.
4. Reenviar, receber e confirmar o e-mail; voltar ao app e tocar **Já confirmei meu e-mail**. Após renovar ID token, o acesso à comunidade e a criação de post e resposta devem funcionar.
5. Confirmar que um campo `email_verified=true` adulterado no perfil Firestore não permite burlar o bloqueio.
6. Testar logout, novo login, falha de conexão e retorno do aplicativo; **com a consulta da política indisponível, uma conta não verificada deve ver a tela de espera/erro e NÃO a comunidade**. Recuperada a conexão, o botão de nova tentativa deve retomar o fluxo normalmente.
7. O responsável confirmou que **não há contas antigas no aplicativo oficial**. Ainda assim, conferir contas de laboratório/Debug em Firebase Authentication sem excluí-las automaticamente.
8. Registrar evidências de QA sem endereço de e-mail, token, link pessoal ou credenciais. Auditar regras e atualizar a aprovação de Release apenas após comprovação.

## Rollback de emergência

O administrador pode definir `enabled=false` no documento administrativo, revertendo o portão para todos os clientes que respeitam essa versão. Isso **não substitui a avaliação de segurança** e, enquanto a obrigatoriedade estiver desativada, nenhum novo Release pode ser assinado/publicado.

## Política de Release

`.github/workflows/build-apk.yml` mantém assinatura bloqueada sem `ATRIO_EMAIL_VERIFICATION_RELEASE_APPROVED=true` **e** aprovação independente do Guardião V2. Publicação OTA também exige a aprovação de e-mail. **Não aprovar a variável antes de implementar e comprovar a obrigatoriedade em produção**. Builds Debug para QA permanecem permitidos.
