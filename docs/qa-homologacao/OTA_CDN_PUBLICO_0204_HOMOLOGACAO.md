# Homologação real do OTA público — Átrio Católico 0.20.3 → 0.20.4

**Escopo:** preparar nova versão normal Release **0.20.4 / versionCode 39**, superior ao Release público **v0.20.3 / versionCode 38**, para comprovar o fluxo real de consulta, download HTTPS pelo GitHub CDN, SHA-256, assinatura, consentimento Android e instalação sobre o app existente.

O proprietário confirmou que instalou 0.20.3 sobre a versão anterior sem perder sessão, discussões ou comentários. A tela **Atualizações do Átrio** exibiu **“O aplicativo está atualizado conforme o canal oficial.”** Isso comprova a instalação de 0.20.3 e o estado consultado, **não** o download de uma versão posterior pelo OTA público.

## Alterações mínimas

- `app/build.gradle.kts`: versão normal `0.20.4`, `versionCode=39` e versão exibida correspondente; sem alterar lógica de negócios, cliente OTA, pacote Android, certificado, regras Firebase, notificações ou moderação.
- Testes de versão ajustados para distinguir o piloto privado `0.20.2/code37` e a versão **já publicada** `0.20.3/code38`; a checagem `newer` não pode aceitar a reutilização da tag v0.20.3.
- Modo de Release já disponível pela PR #177: `ATRIO_RELEASE_MODERATION_MODE=human`. Guardião V2 autônomo não deve ser declarado homologado.
- Branch, PR, checks e merge **não assinam APK nem publicam Release**.

## Risco de distribuição

Uma versão estável no GitHub Releases é uma **atualização real oferecida a todos os usuários** da versão anterior, não um teste privado. Não publicar automaticamente v0.20.4 sem decisão expressa quanto à exposição. A retirada da Release não desfaz uma atualização já instalada.

## Gates de assinatura e publicação

1. Aprovar CI de compilação, versão, Firestore e proteção OTA; revisar PR e integrar à `main`. Confirmar `versionCode=39` e `versionName="0.20.4"`.
2. Conferir o modo de lançamento `ATRIO_RELEASE_MODERATION_MODE=human`, `ATRIO_GUARDIAN_V2_RELEASE_APPROVED=false` e aprovações de OTA/e-mail baseadas em evidências anteriores.
3. Após autorização para assinar, executar `build-apk.yml` manualmente em `main` com a chave permanente. Conferir assinatura fixa SHA-256 `ba2e86eacf32e2785718040d704609d3c95c3b88363c08dd3d7c5abe299902b0`, pacote `br.com.atriocatolico`, código 39, SHA-256 **calculado do novo APK**, atestado `human` e origem da `main`.
4. Executar `ota-publish-release.yml` com `mode=validate`, ID da **nova** run, SHA-256 **novo**, artifact `atrio-catolico-release-assinado` e notas factuais. Não reutilizar o SHA do 0.20.3.
5. Somente depois de validar e aceitar a distribuição pública, executar `mode=publish` e `confirmation=PUBLICAR ATRIO`. Confirmar API `/releases/latest` com tag `v0.20.4`, `draft=false`, `prerelease=false`, assets `atrio-catolico.apk`, `update.json`, `SHA256SUMS.txt` e hash correto.

## Teste real no celular com v0.20.3 ainda instalado

**Não instalar o APK 0.20.4 manualmente antes deste teste:** isso impediria provar o download pelo cliente OTA.

1. Confirmar que a versão instalada ainda é `0.20.3/code38`, com sessão/dados intactos e internet. Não divulgar dados pessoais das capturas.
2. Em **Perfil → Atualizações do Átrio**, tocar **Verificar atualizações**. Esperado: **“Nova versão oficial detectada: 0.20.4”**.
3. Tocar em **Baixar** no próprio aplicativo. Registrar progresso e verificação da integridade, certificado e versão.
4. Tocar **Instalar**, aceitar a permissão de fonte somente se o Android solicitar e confirmar pelo instalador do sistema, **sem desinstalar** a versão atual.
5. Reabrir o Átrio, verificar `0.20.4/code39`, sessão, discussões e comentários preservados. Tocar **Verificar atualizações**: deve mostrar **“O aplicativo está atualizado conforme o canal oficial.”**
6. Registrar erros reais, caso ocorram; não declarar OTA 100% aprovado sem o ciclo inteiro.

## Critério de aprovação

**Consulta 0.20.4 → download GitHub CDN → SHA-256 e certificado corretos → instalação Android sobre 0.20.3 → preservação de dados → consulta UpToDate.**

Os testes privados loopback e o sucesso do pipeline não substituem essa prova.

Evidências: [Release v0.20.3](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/releases/tag/v0.20.3) e [issue #149](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/149).
