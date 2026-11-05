# Candidato de release Átrio Católico 0.20.1 — primeiro APK com atualizador OTA

Preparado em 31/10/2026. **Ainda não aprovado para distribuição.**
Base: `main` após integração das PRs #65, #66, #67 e #68.
Branch: `release/atrio-v0.20.1-ota-candidate-20261031`.

## Identidade Android

- Aplicativo: `br.com.atriocatolico` (sem alteração).
- Versão anterior integrada: `0.20.0` / `versionCode = 35`.
- Candidato proposto: `0.20.1` / `versionCode = 36`.
- Assinatura release: **mesma chave permanente** já configurada no workflow manual do GitHub Actions. Nenhuma chave nova é gerada nem exposta.
- Debug: `0.19.7` / code 34 permanece separado e não é distribuído como release.
- Este PR **não** assina, compila manualmente, publica Releases, cria tags, faz deploy, ativa política do Guardião ou altera Firebase/Cloudflare.

## Recursos do candidato

- Detector de novas versões oficiais em GitHub Releases, com validações de pacote/certificado/URL/código de versão.
- Aviso e seção de atualizações no Perfil.
- Download voluntário do APK, progresso, cancelamento, checagem de SHA-256 e certificado.
- Abertura do instalador do Android com confirmação do usuário, quando permitida.
- A publicação de uma futura versão pelo GitHub Releases é separada, manual e sujeita a aprovação.

**Não confundir compilação aprovada com instalação real confirmada.** Esta funcionalidade OTA ainda não foi testada com dois APKs release assinados no celular.

## Bloqueios antes do primeiro APK com OTA

1. Finalizar QA de atualização no emulador (PR #69). Esse ensaio usa chave debug temporária, não a chave oficial.
2. Revisar/integrar esta PR e conferir todos os checks do Android/segurança.
3. Confirmar fingerprint confiável do certificado release permanente. Não enviar JKS, senhas nem prints com secrets.
4. Confirmar se `ATRIO_GUARDIAN_V2_RELEASE_APPROVED` e backend aprovados permitem o workflow manual normal `build-apk.yml`. Não contornar bloqueios de produção.
5. Acionar **manualmente** o workflow de release da `main` com credenciais protegidas e confirmar `assembleRelease`, `apksigner`, pacote e code 36.
6. Executar pré-voo do APK oficial e conferir integridade e fingerprint antes de transferir a um telefone.
7. Em Android real com 0.20.0 **release** instalado com a mesma chave, testar instalação 0.20.1 sobre o anterior. Confirmar sessão e dados. Se o aparelho ainda usa APK debug de assinatura diferente, separar migração única e proteger dados locais antes de desinstalar.
8. No aplicativo 0.20.1, testar consulta sem release, Internet indisponível e manifesto inválido. Só disponibilizar APK a convidados-piloto quando todos os critérios relevantes forem aprovados.
9. **Não publicar GitHub Release 0.20.1 antes da homologação.** A atualização seguinte (ex.: 0.20.2 / code maior que 36) será o primeiro teste completo de download e instalação OTA pelo próprio Átrio.

## Nota técnica sobre instalações de teste anteriores

Embora não existam contas antigas no aplicativo oficial, caso haja alguma instalação de teste 0.20.0, ela não contém detector nem instalador OTA. A passagem para 0.20.1 requer instalação convencional **uma vez**, preservada a compatibilidade de assinatura. Depois disso, o Átrio poderá oferecer versões posteriores pelo próprio atualizador, sempre com a confirmação do Android.

## Operação e custo

Os checks de PR são reaproveitados. O release assinado deve continuar restrito ao acionamento manual aprovado na `main`. A distribuição via GitHub Releases não exige contratação de serviço novo, mas está sujeita a políticas e limites do GitHub e do Android. O backup original continua intocado.

## Reconciliação com a main em 04/11/2026

- Integra-se a `main` no commit `1c66a76a2b43c42d0ac1b6dc65fab0dd27771f4c` sem descartar as mudanças já incorporadas ao aplicativo.
- O candidato `0.20.1` / `versionCode 36` agora inclui o cadastro aprimorado e a confirmação de e-mail exercitados no Firebase Emulator pela PR #127. **Isso não comprova entrega de e-mail real.**
- O último APK oficial `0.20.0` / code 35 foi assinado em 31/10/2026 (run `41174393714`), em commit anterior à verificação de e-mail. Esse APK não pode homologar o novo cadastro.
- Não gerar assinatura nem publicar a versão sem a aprovação explícita da integração Guardian V2 exigida em `.github/workflows/build-apk.yml`; nunca alterar ou ignorar essa trava por conveniência.
- A flag `app_config/email_verification` permanece desativada em produção até a homologação do bloqueio obrigatório. O responsável informou em 05/11/2026 que **não existem contas antigas no aplicativo oficial**, portanto não há migração de usuários oficiais pendente.

## Nova condição obrigatória de lançamento (05/11/2026)

**Decisão do responsável pelo projeto:** nenhum novo APK **Release assinado** nem publicação pelo GitHub Releases antes da implementação e homologação da confirmação **obrigatória** de e-mail. APKs **Debug para QA** podem continuar, sem distribuição como Release.

- O teste Android Debug com cadastro, reenvio e confirmação de e-mail foi aprovado no aparelho pelo responsável. Isso **não** demonstra que a exigência já está ativa para todos os usuários.
- O Firebase de produção mantém a política `app_config/email_verification` desativada/ausente. A publicação e as respostas de contas não verificadas devem ser negadas no Firestore pelo claim verdadeiro do Firebase Auth, não por um marcador no perfil.
- Antes de autorizar Release: implementar e validar a obrigatoriedade em produção; testar contas verificadas e não verificadas; conferir separadamente se há contas de QA no Firebase Authentication, sem excluí-las automaticamente; comprovar reenvio, atualização do token e novo login no Android; estabelecer rollback seguro.
- A trava `ATRIO_EMAIL_VERIFICATION_RELEASE_APPROVED` é **independente** da aprovação do Guardião V2. `.github/workflows/build-apk.yml` exige as duas aprovações para gerar APK assinado, e `.github/workflows/ota-publish-release.yml` exige a aprovação de e-mail para publicar. A ausência da variável, ou valor diferente de `true`, mantém o lançamento bloqueado.
- A variável só deve ser configurada **após comprovar a obrigatoriedade**. Seu valor, isoladamente, não configura nem verifica a segurança do Firebase.
- Nenhum backup, segredo, Worker ou regra do Firebase foi modificado nesta atualização documental/de CI.

## Esclarecimento do responsável — 05/11/2026

O responsável confirmou expressamente que **não existem contas antigas no aplicativo oficial**. Não exigir plano de migração de usuários oficiais como condição de lançamento. Isso não certifica que o Firebase Authentication esteja vazio: contas criadas durante QA/Debug devem ser auditadas sem exclusão automática e sem usar dados reais de usuários como massa de testes.

A confirmação obrigatória poderá ser exigida **desde o primeiro lançamento oficial com novos cadastros**. Ainda é necessário provar no Firebase produtivo que contas com e-mail não verificado não conseguem publicar ou responder, e que contas verificadas conseguem após renovar o token. A aprovação do teste de envio de e-mail no Debug não substitui esse ensaio de regras em produção.

As travas de assinatura e publicação continuam ativas até homologação; os backups e o Firebase de produção permanecem intocados.
