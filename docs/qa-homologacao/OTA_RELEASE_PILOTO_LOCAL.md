# Átrio Católico — piloto OTA Release privado no Android

**Objetivo:** ensaio A → B com atualização dentro do aplicativo sem publicar um GitHub Release. Este procedimento não autoriza assinatura ou distribuição. O APK 0.20.0/code35 é referência de certificado, mas **não possui OTA**.

## Configuração de segurança

| Elemento | Release oficial | Debug laboratório | Release piloto |
| --- | --- | --- | --- |
| Pacote Android | `br.com.atriocatolico` | `br.com.atriocatolico.otalab` | `br.com.atriocatolico` |
| Assinatura | Certificado permanente | Certificado Debug do QA | **Certificado permanente obrigatório** |
| Fonte OTA | GitHub Releases HTTPS | Loopback `127.0.0.1:8765` | Loopback `127.0.0.1:8765` |
| HTTP remoto | Bloqueado | Bloqueado | Bloqueado |
| Automático em CI | Apenas Debug | Ambiente isolado | **Desativado por padrão** |
| Publicação | Gates manuais | Proibida | Proibida |

O `otaPilot` não usa `applicationIdSuffix`, não é depurável e reutiliza os componentes reais de consulta, download, SHA-256, assinatura e instalador. A exceção do verificador de assinatura permanece **exclusiva ao Debug**. HTTP só pode acessar o host local fixo, através de configuração de segurança da variante. Produção normal continua exclusivamente em GitHub Releases HTTPS.

## Preparação assinada A e B — pendente

**Não foram produzidos APKs assinados nesta etapa.** O novo buildType foi adicionado, mas nenhuma chave foi lida e nenhuma permissão de publicar foi ativada. Um procedimento de assinatura controlada futuro deve:

1. Utilizar a **chave permanente já existente**, sem criar outra, sem publicar segredos, e conferir o certificado SHA-256 público histórico.
2. Gerar base A com OTA integrado, por exemplo versão 0.20.1/code36, e candidato B posterior, por exemplo 0.20.2/code37, partindo de fontes auditadas.
3. Empregar exclusivamente a tarefa Gradle `:app:assembleOtaPilot`, com `ATRIO_OTA_RELEASE_PILOT=1` e confirmação explícita `ATRIO_OTA_PILOT_CONFIRM=HOMOLOGAR ATRIO SEM PUBLICAR`, mais as quatro variáveis de assinatura já usadas no projeto. Não utilizar `assembleRelease` nem desabilitar gates oficiais.
4. Executar `scripts/ota_release_pair_preflight.py` para conferir ambos os APKs, assinaturas, versões crescentes e hashes independentes; armazenar os candidatos de modo privado e temporário.

O CI pode compilar a variante **sem assinar** em modo `ATRIO_OTA_PILOT_COMPILE_ONLY=1`. Isso não produz APK Release homologado nem habilita publicação.

## Servidor privado no mesmo aparelho

`scripts/ota_release_pilot_server.py` serve exclusivamente `127.0.0.1:8765`, sem Firebase, Cloudflare, segredos ou acesso público. Oferece apenas três rotas fixas de descoberta, manifesto e download e valida o hash/tamanho do arquivo antes de cada transferência. Seu manifesto respeita o formato real do cliente OTA.

**Preparação confiável no runner com Android SDK**, após verificar a assinatura do APK B:

```sh
python3 -m scripts.ota_release_pilot_server \
  --apk /caminho/versao-b.apk \
  --android-sdk "$ANDROID_HOME" \
  --candidate-sha256 SHA256_INDEPENDENTE_DO_APK_B \
  --base-code 36 \
  --write-manifest /caminho/update-piloto-local.json \
  --verify-only
```

**Execução no Termux do celular**, com APK B e manifesto previamente validados transferidos privadamente ao aparelho:

```sh
python3 -m scripts.ota_release_pilot_server \
  --apk /caminho/versao-b.apk \
  --validated-manifest /caminho/update-piloto-local.json \
  --candidate-sha256 SHA256_INDEPENDENTE_DO_APK_B \
  --base-code 36
```

No Termux não é necessário instalar Android SDK; o script confere **contrato exato do manifesto**, certificado oficial público **declarado**, hash e tamanho do APK. O manifesto sozinho não comprova criptograficamente a assinatura: isso deve ter sido comprovado com `apksigner` anteriormente. O aplicativo revalida a assinatura real via Android `PackageManager` ao baixar e antes de instalar.

Para emulador, `adb reverse tcp:8765 tcp:8765` pode usar o loopback da máquina host. Não alterar bind para `0.0.0.0`, não abrir túnel público nem autorizar hosts externos. A assinatura e os hashes protegem contra substituição de APK.

## Checklist de homologação física

- [ ] Registrar hashes A/B e confirmar o mesmo certificado permanente e `versionCode` crescente.
- [ ] Instalar A **sem desinstalar** o Átrio existente; registrar sessão de uma conta de teste e dado local não sensível.
- [ ] Iniciar servidor local no Termux; abrir **Perfil → Atualizações do Átrio** em A e detectar B.
- [ ] Baixar B, validar, autorizar origem quando necessário, confirmar instalador Android e atualizar A por cima.
- [ ] Reabrir e comprovar versão B, sessão, preferências e dados locais preservados.
- [ ] Ensaiar ausência de rede, download cancelado, falta de espaço, hash incorreto, assinatura diferente, downgrade e permissão recusada.
- [ ] Documentar modelo, Android/API, hashes e resultado sem tokens, senhas ou dados pessoais.

O piloto **não valida automaticamente o GitHub Releases público**. Esse canal requer auditoria adicional antes de distribuição. Permanecem bloqueados `ATRIO_OTA_E2E_TESTED`, `ATRIO_OTA_RELEASE_APPROVED` e os demais gates de e-mail e Guardião.

**Situação:** piloto implementado em código; dois candidatos oficiais assinados e execução física ainda pendentes. Não encerrar [issue #149](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/149) sem evidências.
