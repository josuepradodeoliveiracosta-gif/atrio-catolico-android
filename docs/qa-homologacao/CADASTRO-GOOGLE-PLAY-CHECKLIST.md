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
- [ ] Definir e testar estratégia de e-mail verificado antes de publicar, inclusive regras no servidor e compatibilidade com contas existentes.
- [ ] Testar login/cadastro em Android real, offline, teclado, acessibilidade, criação parcial de perfil, atualização e recuperação.

## Restrições
Não habilitar bloqueio de publicações sem migração de contas existentes. Não criar endpoints fictícios, políticas legais sem revisão ou fluxos de exclusão que deixem dados residuais. Não alterar assinatura, produção Firebase/Cloudflare ou backups nesta etapa.
