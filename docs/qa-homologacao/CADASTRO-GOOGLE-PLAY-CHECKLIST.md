# Checklist de conformidade do cadastro — Google Play

Estado: **parcialmente implementado**. Não declarar conformidade nem publicar antes de fechar todos os itens abaixo.

## Implementado no aplicativo
- [x] Nome público (2–35 caracteres), e-mail validado e confirmação de senha.
- [x] Política local para novas senhas (15–128 caracteres), sem exigir troca das senhas antigas ao entrar.
- [x] Mostrar/ocultar senha e suporte a autofill do Android.
- [x] Aceite explícito das **Regras da Comunidade** com leitura no cadastro.
- [x] Envio de verificação de e-mail após criar conta (não bloqueia UGC até backend estar pronto).
- [x] Mensagens de erro amigáveis e recuperação de senha.
- [x] Recuperação de perfil não concluído.

## Pendências bloqueadoras de publicação
- [ ] Publicar **Termos de Uso** e **Política de Privacidade** reais em URLs públicas estáveis; revisão jurídica/LGPD e declarações de Data Safety no Play Console. Não apresentar aceite genérico a documentos inexistentes.
- [ ] Definir responsável, contato e procedimento de atendimento e publicar página web para **solicitar exclusão de conta e dados**.
- [ ] Implementar exclusão autenticada dentro do app, com reautenticação, tratamento seguro de Firebase Auth, Firestore, imagens, dispositivos de push e dados associados, respeitando retenções legais documentadas. Não apagar somente o documento de perfil.
- [ ] Auditar denúncia/bloqueio de usuários e conteúdos, moderação de UGC, termos de conduta, procedimentos e resposta a denúncias.
- [ ] Se classificado como Social, verificar política de segurança infantil, padrões públicos, canal de denúncia e contato responsável.
- [ ] Confirmar público-alvo, classificação, permissões e declarações Play Console.
- [ ] Configurar no **Firebase Authentication** política de senha mínima de 15 caracteres (não basta validar no APK). Avaliar proteção contra credenciais vazadas e abuso sem enviar senha em texto puro.
- [x] Preparar e testar no Firebase Emulator a regra condicional de e-mail verificado em publicações e respostas; sincronizar ID token após confirmação e exibir orientação ao usuário.
- [ ] **Implantar e homologar** as regras no Firebase de produção; distribuir APK compatível; testar contas antigas e então ativar `app_config/email_verification` administrativamente. O bloqueio **ainda não está ativo**.
- [ ] Testar login/cadastro em Android real, offline, teclado, acessibilidade, criação parcial de perfil, atualização e recuperação.

## Restrições
Não habilitar bloqueio de publicações sem migração de contas existentes. Não criar endpoints fictícios, políticas legais sem revisão ou fluxos de exclusão que deixem dados residuais. Não alterar assinatura, produção Firebase/Cloudflare ou backups nesta etapa.


## Novo portão de verificação de e-mail — implantação gradual

1. A versão compatível já envia o link de confirmação no cadastro e permite reenviá-lo em **Meu perfil**. Depois de tocar em **Já confirmei meu e-mail**, o app executa `reload()` e renova explicitamente o ID token com `getIdToken(true)`.
2. `firestore.rules` possui `emailVerificationAllowsPublishing()` para **criar** posts e respostas. A função valida `request.auth.token.email_verified` no servidor; nunca aceita uma flag de perfil controlada pelo usuário.
3. **Desativado por padrão:** ausência de `app_config/email_verification`, `enabled=false` ou versão diferente não restringem ninguém. A regra impede que o APK altere essa configuração.
4. Após implantar e testar as regras, distribuir APK compatível e tratar contas existentes, o operador autorizado poderá criar ou ajustar **somente pelo Firebase Console** `app_config/email_verification` com `enabled=true` e `version="2026-11-v1"`. Não habilitar antes da homologação. Para desfazer, usar `enabled=false`.
5. `tests/security/email-verification-gate.test.mjs` testa acesso à configuração, contas verificadas e não verificadas, leitura de perfil, postagens, respostas, reversão e compatibilidade emuladas.
6. O bloqueio restringe **novas** publicações e respostas, não impede entrar, visualizar conteúdo, acessar privacidade ou solicitar exclusão. Exige QA de dispositivo real e confirmação da política no Play Console.

**Cuidado:** o backend de exclusão definitiva da PR #98 continua em rascunho e não deve ser habilitado apenas por causa desta mudança.
