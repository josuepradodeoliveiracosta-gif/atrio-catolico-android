# Átrio Católico 0.13.0 — Sistema de selos

## Alterações do aplicativo
- Selos visíveis em publicações, respostas e no perfil.
- Identificação opcional Leigo ou Leiga, alterável pelo próprio titular.
- Pedidos de verificação de Padre ou Diácono sem concessão automática.
- Selo Moderador atribuído apenas pela administração confiável.
- Selo especial Fundador do Átrio, vinculado ao UID definido em `app_config/founder`.

## Pré-requisitos do servidor
- As regras `firestore.rules` com `/badges`, `/badge_requests` e `/app_config/founder` devem estar publicadas antes de distribuir o APK.
- O documento `app_config/founder` deve conter o `uid` da conta oficial do fundador.
- O campo de fundador não deve ser exposto por escrita do cliente.
- Verificação de clero, atribuição de moderadores e revogação de selos ocorrem via Console/Admin SDK; o APK não contém uma ferramenta para aprovar pedidos.
- A permissão real de moderação continua independente em `admins/{uid}`, não no selo visual.

## Atualização do APK
- `versionCode=14` e `versionName=0.13.0`.
- Preservado `applicationId=br.com.atriocatolico` e o mecanismo de assinatura por secrets no GitHub Actions.
- Para atualizar sem desinstalar, instalar o artefato **atrio-catolico-release-assinado** (mesma chave usada nas versões assinadas anteriores).
- Não instalar `app-debug.apk` sobre uma versão release assinada: ele tem assinatura diferente.
- Não alterar nem perder a chave de assinatura permanente. Nunca salvá-la no repositório.
- Nenhuma migração do Firestore ou exclusão de documentos é exigida.

## Validação antes da publicação
- Testes Firestore no emulador: 100 cenários.
- Compilação Android no CI de pull request.
- Confirmar visualmente a exibição do selo Fundador com a conta correspondente.
- Confirmar edição Leigo/Leiga, pedido de verificação e moderação existente.
