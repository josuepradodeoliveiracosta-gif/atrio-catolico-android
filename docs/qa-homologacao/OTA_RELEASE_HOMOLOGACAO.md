# Átrio Católico — homologação Release (autorização de testes)

**Autorização recebida:** homologar Release. **Não equivale** a autorização para publicar ou distribuir, nem comprova que o OTA oficial já foi aprovado. Manter issue #149 aberta e os gates de Release bloqueados.

## Evidência histórica de assinatura (05/11/2026)

Foi recuperado o artefato `atrio-catolico-0.20.0-release-assinado` do GitHub Actions [run 41174393714](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41174393714), artifact id `13031693723`, que continha somente `app-release.apk`. O run concluiu com sucesso, sem publicação. **O artefato está sujeito a expiração (registrada para 07/11/2026)**.

- SHA-256 do APK, não do ZIP: `2c1a55dfdc797e10e8ce9ec371a3136289d039ab99311387e5d02cf010f0c509`.
- Certificado X.509 assinante SHA-256: `ba2e86eacf32e2785718040d704609d3c95c3b88363c08dd3d7c5abe299902b0`.
- Manifesto Android (inspeção binária local): `br.com.atriocatolico`, `versionName 0.20.0`, `versionCode 35`, `minSdk 26`, `targetSdk 35`, `allowBackup false`, não depurável.
- Verificação criptográfica local somente de leitura: assinatura RSA-PKCS1-SHA256 do bloco APK v2, chave pública do certificado e SHA-256 dos chunks assinados coincidem. Não substitui a conferência por `apksigner verify` nem demonstra instalação física.
- A rotina reproduzível `scripts/ota_baseline_0200.py` exige SHA-256 **exato do APK**, certificado fixado, pacote, versão e não depurável, usando ferramentas do Android SDK; não acessa chave privada, não assina e não publica.

```sh
python3 scripts/ota_baseline_0200.py --apk /caminho/app-release.apk --android-sdk "$ANDROID_HOME"
```

O workflow manual `ota-apk-preflight.yml` executa essa proteção adicional quando o artefato selecionado é o Release histórico 0.20.0. Se o artefato estiver expirado, reportar indisponibilidade, nunca fabricar evidência.

## Homologação ainda necessária

1. **O 0.20.0 é exclusivamente a referência histórica de assinatura**: o commit `fcf063e835c37ca1e3f9363a56a4232d30cb8ea0` que gerou esse APK ainda não contém `OtaReleaseClient.kt` ou `OtaUpdatesSection.kt`. Portanto, é impossível homologar uma atualização **iniciada dentro do 0.20.0**.
2. Preparar, sob procedimento específico autorizado e auditável, **duas versões posteriores** com OTA incorporado, mesmo pacote `br.com.atriocatolico`, mesmo certificado permanente, e `versionCode` crescente (por exemplo, versão-base A = `0.20.1/code36`, atualização B = versão posterior `code37`). Nenhum gate de assinatura/distribuição será contornado automaticamente. A autorização de homologação não ativa as flags de publicação.
3. Verificar os dois APKs com `apksigner` e `apkanalyzer`. Instalar a versão A uma única vez pelo procedimento convencional, **sem desinstalar o Átrio oficial existente**, e verificar sessão e dados. Então realizar A → B **dentro do Átrio**: procurar atualização, baixar, validar, abrir o instalador, permitir esta origem quando necessário, confirmar e instalar por cima. Depois de A instalada, **não desinstalar**.
4. Confirmar após reabrir o app a preservação de login, preferências e dados locais não sensíveis. Testar rede indisponível, cancelamento, erro de hash, assinatura distinta, downgrade, permissão recusada e espaço insuficiente real.
5. Registrar evidências sanitizadas (versões, aparelho, Android API, resultado, sem credenciais). Conferir manifesto de `update.json` e APK exatamente iguais ao candidato testado, antes de divulgar qualquer canal externo.
6. Solicitar aprovação **separada** de publicação após provas aprovadas; só então revisar `ATRIO_OTA_E2E_TESTED`, `ATRIO_OTA_RELEASE_APPROVED` e os bloqueios independentes de Guardião V2/e-mail.


**Importante sobre o canal:** o código OTA oficial atual consulta exclusivamente GitHub Releases público/estável; rascunhos ou pré-releases não são oferecidos. A prova A → B em ambiente controlado precisa de um canal técnico isolado e confiável que **não antecipe uma publicação pública**, além de política de assinatura compatível. A inexistência desse canal é um bloqueio de engenharia, não uma autorização para enfraquecer HTTPS, assinatura ou gates.

**Estado:** referência histórica auditada; ausência de candidato mais novo e de prova física oficial impede concluir homologação. Nenhum release assinado, GitHub Release, keystore, backup, Firebase ou Cloudflare de produção é alterado por esta etapa.
