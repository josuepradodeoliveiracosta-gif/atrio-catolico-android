# Cadastro V2 — auditoria de segurança e arquitetura (PDF 06/11/2026)

Branch `feature/cadastro-v2-pdf-20261106`; base de comparação imutável `95e7f94e312b2cf7acf54dd547e6390e947bb0ba`. Implementação Android/Kotlin/Compose reutilizando Auth/Firestore já presentes.

## Situação existente
- `OnlineAuthScreen` (OnlineAtrioApp.kt): login e cadastro e-mail/senha, `RegistrationPolicy` (15-128 caracteres), regra comunitária, `FirebaseAuth`, recuperação de senha, gravação de `profiles/{uid}`.
- `EmailVerificationPanel` e `MandatoryEmailVerificationGate`: reenvio, refresh e token claim; configuração administrativa de exigência em `app_config/email_verification`; não mudar o flag de produção neste trabalho.
- `CommunityRulesGate` e `community_consents`: aceitação versionada existente, aplicada sob flag de rollout; manter.
- `profiles/{uid}` é privado, `public_profiles/{uid}` somente opt-in, selos verificados usam grants e revisões de admin. Não criar caminho novo de poder/clero.
- Preferência de push por dispositivo, com autorização Android e FCM. Não acionar automaticamente.
- Conta antiga não pode ser obrigada a fazer novo registro; perfis/regras atuais não serão substituídos.

## Abordagem do PDF
1. Incluir boas-vindas e entrada separada (para compatibilidade, os testes antigos usam o fluxo legado no emulador).
2. Reusar formulário existente com nome/e-mail/senha/confirmar, mensagens seguras, aceite das regras da comunidade.
3. Verificação de e-mail já existente; novas contas devem usar gate e exibir sucesso somente depois de confirmação.
4. Tela opcional pós-confirmação para participação autodeclarada, interesses, paróquia e cidade, **não obrigatória**. Campos religiosos dependem de consentimento específico, início desmarcado. Não atribuir selos.
5. Perfil permite revisar/apagar os dados privados e retirar consentimento. Sem publicidade automática.
6. Firestore Rules: coleções privadas additivas (sem mudar `profiles`, selos ou dados de contas existentes) com proibição de campos desconhecidos, acesso por UID, validação de strings/listas e timestamps.
7. CI Firestore Emulator adversarial + unitários Android + UI em emulador, Debug; **sem publicação das novas rules de produção** antes de autorização separada. Não ativar globalmente política de e-mail sem conferir versões instaladas.

## Bloqueio jurídico e operacional antes da release
- Termos de Uso e Política de Privacidade completos, retenção/bases legais, tratamento de dados religiosos e cadastro de menores requerem revisão jurídica/documental. O formulário atual oferece apenas aceite das regras da comunidade e descreve essa limitação; **não afirmar que a LGPD foi integralmente homologada**.
- Regras não publicadas tornam gravacão de novas preferências indisponível em produção até deploy autorizado.
- Versão Release com assinatura permanente, backup protegido, `main`, configuração de produção, Cloudflare e privilégios permanecem intactos.

## Reversão
Fechar PR / descartar branch; nada de migração destrutiva, exclusão ou sobrescrita de documentos existentes. Produção não sofre alterações.
