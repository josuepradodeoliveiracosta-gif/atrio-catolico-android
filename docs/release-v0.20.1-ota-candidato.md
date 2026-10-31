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

## Limite fundamental para usuários atuais

A versão 0.20.0 não contém detector nem instalador: portanto, quem usa 0.20.0 precisará instalar a 0.20.1 **uma vez** pelo processo convencional. Depois disso, o Átrio poderá oferecer as versões posteriores pelo seu próprio atualizador, sempre com a confirmação do Android.

## Operação e custo

Os checks de PR são reaproveitados. O release assinado deve continuar restrito ao acionamento manual aprovado na `main`. A distribuição via GitHub Releases não exige contratação de serviço novo, mas está sujeita a políticas e limites do GitHub e do Android. O backup original continua intocado.
