# Átrio Católico — homologação da atualização OTA pelo GitHub público

**Plano para o candidato 0.20.4 / versionCode 39.** Estado inicial: **não publicado; não assinado**.

## Base homologada sem repetição

- O Release estável [v0.20.3](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/releases/tag/v0.20.3) está público com `atrio-catolico.apk`, `update.json` e `SHA256SUMS.txt`.
- No celular, o proprietário instalou 0.20.3 sobre a versão privada anterior, observou "O aplicativo está atualizado conforme o canal oficial" e confirmou sessão, discussões e comentários intactos.
- O piloto privado OTA A→B anterior e cenários negativos de assinatura, integridade, permissão e interrupção já foram homologados. **Não repetir**.
- **O que ainda falta:** uma instalação de 0.20.4 feita pelo próprio cliente OTA, com APK transferido do **CDN público HTTPS do GitHub** e certificado permanente, sobre 0.20.3/code38.

## Mudança proposta

A branch altera **apenas** os metadados de versão normal Release: `0.20.3/code38 → 0.20.4/code39`, inclusive versão visível. Mantém `applicationId=br.com.atriocatolico`, chave permanente e certificado SHA-256 `ba2e86eacf32e2785718040d704609d3c95c3b88363c08dd3d7c5abe299902b0`, Firebase, Cloudflare, moderação humana, regras e flags da experiência OTA. Não instalar um Debug sobre o pacote oficial.

A publicação de 0.20.4 terá efeito público para todos os usuários 0.20.3, portanto deve receber revisão independente e notas transparentes: *"Atualização incremental 0.20.4 para homologação do canal de atualização HTTPS. Sem novas funcionalidades."* Não chamar de teste fictício: será um Release verdadeiro.

## Portões antes de publicar

1. Revisar PR da versão, executar checks Android/Firestore/OTA/segurança/versão no GitHub e integrar apenas após resultados aprovados.
2. Com moderação humana selecionada (`ATRIO_RELEASE_MODERATION_MODE=human`), as aprovações de OTA e e-mail já documentadas continuam obrigatórias. Guardião V2 **não** deve ser marcado como homologado.
3. Acionar **manualmente** `build-apk.yml` na `main` para **0.20.4/code39**, sem alterar secrets; conferir artifact `atrio-catolico-release-assinado`, mode `human`, certificado permanente e novo SHA-256. **Não reutilizar o SHA-256 do 0.20.3**.
4. Acionar **manualmente** `ota-publish-release.yml` com `mode=validate`, `apk_run_id` novo, `artifact_name=atrio-catolico-release-assinado`, novo `expected_apk_sha256` e notas de versão. Só continuar após `success`.
5. Acionar `mode=publish` com os mesmos parâmetros e a confirmação exata `PUBLICAR ATRIO`, mediante decisão de divulgação. Verificar tag `v0.20.4`, `draft=false`, e presença de `atrio-catolico.apk`, `update.json`, `SHA256SUMS.txt`. Não sobrescrever a v0.20.3.

## Teste físico decisivo, usando o aparelho que já tem 0.20.3

- **Antes:** registrar que o aplicativo instalado mostra **v0.20.3/code38**, usuário logado, uma discussão e um comentário já existentes; garantir internet e espaço livre. Não desinstalar nem limpar dados.
- **Detecção:** em **Perfil → Atualizações do Átrio**, tocar **Verificar atualizações**. Resultado esperado: **"Nova versão oficial detectada: 0.20.4"**.
- **Transferência:** tocar em baixar; observar progresso até 100%. Validar que o APK é baixado via GitHub HTTPS e coincide com tamanho/SHA-256 do manifesto publicado. Qualquer erro é evidência de **NO-GO** para homologação OTA pública.
- **Instalação:** tocar instalar, conceder permissão Android de fonte externa ao Átrio se solicitada, confirmar no instalador **sobre a versão existente**. Deve instalar **0.20.4/code39** com o **mesmo certificado** sem solicitar remoção da anterior.
- **Depois:** abrir o app, conferir versão 0.20.4, sessão preservada, discussões, comentários, perfil e acesso ao canal oficial sem atualização adicional. Relatar a mensagem exibida e qualquer falha sanitizada na issue #149.
- **Resultado:** somente após esse fluxo completo dar **PASS físico** e uma URL pública real validada, declarar **OTA CDN GitHub E2E homologado**.

**Em caso de falha:** não desinstalar, não trocar o certificado, não desativar gates e não apagar backup. Manter v0.20.3 publicada enquanto se corrige a falha; para uma versão pública distribuída, não é possível simplesmente instalar uma APK de versionCode inferior como rollback. Uma correção exige nova versão com código superior e aprovação. Nunca divulgar tokens, emails de contas ou dados pessoais nas issues.

Auditoria central: [issue #149](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/149).
