# Átrio Católico — Homologação OTA (Etapa 5, prova isolada)

Preparado em 31/10/2026 a partir da `main` que integrou PRs #65–#68.
**O objetivo deste teste é verificar que o Android atualiza um pacote sem perder arquivo local quando a assinatura coincide e o `versionCode` aumenta.** Não confundir esse teste com OTA ponta a ponta nem com instalação pelo usuário.

## Cenário automatizado

- Compila **APK debug v0.19.7 / code 34** no GitHub Actions sem secrets de assinatura.
- Na mesma máquina, altera **temporariamente só a cópia de trabalho** de `val atrioDebugPatch = 7` para `8`, compila **APK debug v0.19.8 / code 35**. Essa edição não modifica a `main` nem a versão release `0.20.0`.
- Confere pacote `br.com.atriocatolico`, assinatura debug válida, fingerprint de certificado idêntico e aumento do versionCode.
- Em emulador Android 35, instala o primeiro APK, cria marcador de arquivo privado via `run-as`, instala o segundo com `adb install -r` e comprova que o marcador continua acessível e a versão aumentou.
- Não abre o aplicativo nem inicia sessão Firebase durante o ensaio. Nenhum dado real de usuário é consultado.
- O workflow é disparado numa PR que modifica o script/workflow, ou manualmente pelo proprietário na branch principal após integração.

Arquivo de execução: `.github/workflows/ota-upgrade-qa.yml`.
Roteiro: `scripts/ota_qa_upgrade.sh`.
Sem uso de chaves oficiais, sem downloads públicos e sem permissão para publicar releases.

## Critérios ainda pendentes para a primeira versão OTA aos usuários

- [ ] Confirmar o SHA-256 do certificado permanente a partir de uma fonte confiável.
- [ ] Confirmar que o release 0.20.0 foi instalado com esse certificado nas contas dos testadores.
- [ ] Configurar a variable `ATRIO_RELEASE_CERT_SHA256` no GitHub sem divulgar o JKS nem senhas.
- [ ] Proteger a `main` e as tags oficiais `v*` por regras de repositório.
- [ ] Executar o workflow manual de auditoria de APK real e analisar o resultado.
- [ ] Preparar release-candidato **com versionCode superior a 35**, mesma chave e recursos OTA integrados. Nunca distribuir a versão 0.20.0 inalterada como atualização de si mesma.
- [ ] Homologar em um aparelho Android real com duas versões *release*, preservação de sessão, conteúdo sincronizado e dados locais.
- [ ] Testar download interno, interrupção, SHA-256 inválido, assinatura diferente, autorização de instalação pelo sistema, retorno ao aplicativo e indisponibilidade de rede.
- [ ] Só então executar `OTA Etapa 2 — preparar ou publicar GitHub Release oficial` no modo `publish` após validação bem-sucedida e autorização do proprietário.

## Distribuição inicial

Como nenhum Átrio anterior possui o atualizador, o primeiro APK **com o recurso** ainda terá de ser instalado uma vez pelo usuário. Somente as **atualizações posteriores** poderão ser obtidas diretamente dentro do Átrio.

O Android sempre conserva a autorização/confirmação da instalação, quando exigida.

## Segurança e custo

Não gerar ou trocar a chave permanente. Não usar backend novo nem modificar Cloudflare/Firebase. Não enviar dados nem APKs reais ao workflow. O job de emulador consome minutos de GitHub Actions, portanto executar apenas quando o código de QA mudar ou o responsável pedir uma nova homologação.
