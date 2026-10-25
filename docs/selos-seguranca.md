# Selos da comunidade — operação segura

Este documento descreve os caminhos esperados pelo aplicativo na ramificação de desenvolvimento.
**Não implante as regras nem distribua o APK da ramificação até os testes passarem e o responsável aprovar a implantação.**

## Modelo de dados

- `/badges/{uid}`: identificação pública. Campos:
  - `lay` (opcional): `leigo`, `leiga` ou string vazia para remover autodeclaração; o titular pode modificar **somente** esse campo.
  - `clergy` (opcional): `padre` ou `diacono`; somente administração confiável pode definir.
  - `moderator` (opcional): booleano; somente administração confiável pode definir.
- `/badge_requests/{uid}`: solicitação privada de conferência. Titular cria com `kind: "padre" | "diacono"`, `status: "pending"`, `createdAt` com timestamp do servidor. Pode reapresentar depois de `rejected` ou `dismissed`. O titular não consegue aprovar.
- `/app_config/founder`: documento com `uid` da conta oficial do fundador, definido somente por administração confiável. Não depende do nome público nem do e-mail.

## Ativação administrativa sem riscos

1. Antes de implantar qualquer APK com selos, executar os testes de segurança no emulador e validar a compilação.
2. Conferir diferenças das regras em `firestore.rules`; só publicar com autorização explícita do proprietário.
3. Publicar regras da ramificação **revisadas** usando o comando Firebase CLI apropriado, a partir da pasta correta, e verificar o estado no Console. Não executar implantação automaticamente em CI.
4. No Console do Firestore, abrir o documento `app_config/founder` e definir `uid` com o UID exato da conta oficial, obtido de Firebase Authentication.
5. Para verificação sacerdotal, validar a identidade por procedimento administrativo externo ao app. Após aprovação, no Console/SDK administrativo escrever `badges/{uid}.clergy` com `padre` ou `diacono` e `badge_requests/{uid}.status` como `approved`.
6. Para Moderador, escrever `badges/{uid}.moderator = true` somente após designação formal. **Este selo é visual e não concede permissões Firestore**: manter privilégios reais exclusivamente em `admins/{uid}`.
7. Revogar selos pela mesma via administrativa confiável, removendo `clergy` ou alterando `moderator = false`. O cliente não consegue fazê-lo.

## Segurança

- `profiles` permanece privado; os demais usuários não podem enumerar perfis.
- Um usuário autenticado pode consultar um `badges/{uid}` individual, mas não listar toda a coleção.
- O app não concede selos de Padre, Diácono, Moderador ou Fundador com base apenas em texto do perfil ou pedido.
- Nenhuma operação de teste deve utilizar dados reais: a suíte roda no emulador Firestore com IDs de demonstração.
- As alterações no Firestore de produção e na assinatura de APK não fazem parte dessa ramificação.
