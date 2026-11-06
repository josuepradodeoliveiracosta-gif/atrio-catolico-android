# Entrega criptografada dos candidatos OTA Release A/B — homologação privada

**Este roteiro não publica o Átrio.** O workflow manual `.github/workflows/ota-pilot-signed-encrypted.yml` produz dois APKs `otaPilot` com o mesmo identificador `br.com.atriocatolico`, a mesma chave permanente já configurada em GitHub Secrets e versões 0.20.1/code36 (A) e 0.20.2/code37 (B). Exige execução na `main` pelo titular do repositório, confirmação textual e chave pública de cifragem informada pelo próprio titular.

**Não há candidatos assinados até que a execução manual seja disparada.** A autorização anterior refere-se apenas à homologação; o lançamento aos usuários requer autorização separada. Não alterar os gates `ATRIO_OTA_E2E_TESTED`/`ATRIO_OTA_RELEASE_APPROVED`.

## Por que a criptografia é obrigatória?

O repositório é público. Mesmo que um arquivo do GitHub Actions seja baixável somente sob autenticação em certas interfaces, **não presumimos que o artefato será privado**. Por isso o workflow publica somente um `.zip.age`, cifrado com chave pública X25519/age; **APK, chave privada e ZIP aberto nunca são enviados como artefato**. A retenção é de um dia, e a chave de assinatura permanece restrita ao runner e aos segredos GitHub existentes.

A chave `age` de destino é **diferente** do keystore permanente do Android: serve somente para transportar arquivos criptografados. Nunca mova/exporte o keystore original para o celular ou para o chat.

## 1. Criar a chave de recebimento no Termux

Com Termux configurado no celular Android, rode:

```sh
pkg update
pkg install age python
umask 077
mkdir -p "$HOME/.config/atrio-ota"
age-keygen -o "$HOME/.config/atrio-ota/pilot-age-identity.txt"
age-keygen -y "$HOME/.config/atrio-ota/pilot-age-identity.txt"
```

O último comando mostra **somente a chave pública** começando com `age1...`. Guarde o arquivo `pilot-age-identity.txt` de forma privada: quem possui essa chave privada pode decifrar os APKs. Não envie esse arquivo, prints do conteúdo, senhas ou a chave privada ao ChatGPT/GitHub. Se perder a chave privada, não será possível abrir o artefato cifrado.

## 2. Autorizar uma única execução manual

No GitHub, abra **Actions → OTA homologação — par A/B criptografado sem publicar → Run workflow**, escolha a branch `main` e informe:
- `age_public_recipient`: a chave **pública** exibida por `age-keygen -y`.
- `confirmation`: `HOMOLOGAR ATRIO SEM PUBLICAR`.

A execução apenas inicia se o titular dispará-la manualmente na `main`, na primeira tentativa. É possível configurar **revisores obrigatórios** no Environment GitHub `ota-pilot-homologacao` como uma segunda autorização; não presuma que o Environment foi configurado para exigir aprovação até confirmar nas configurações.

O job exige que os três secrets de assinatura já existentes estejam presentes (sem exibi-los) e nunca modifica a senha, o arquivo original do keystore nem os gates de produção. Caso a assinatura não corresponda ao certificado oficial pinado (SHA-256 `ba2e86eacf32e2785718040d704609d3c95c3b88363c08dd3d7c5abe299902b0`), os dois candidatos são rejeitados antes de serem exportados.

**Cotas:** essa etapa faz duas compilações Android em um único job manual; pode consumir minutos de GitHub Actions. Não é executada automaticamente e não consome sua cota GPT Work.

## 3. Receber e decifrar privadamente

Após sucesso do workflow, baixe seu único artefato denominado `atrio-ota-piloto-ab-cifrado` (disponível por até um dia). Ele contém somente `atrio-ota-piloto-ab.zip.age`.

No Termux, após copiar o arquivo cifrado para um diretório local:

```sh
umask 077
mkdir -p "$HOME/atrio-ota-homologacao"
age -d \
  -i "$HOME/.config/atrio-ota/pilot-age-identity.txt" \
  -o "$HOME/atrio-ota-homologacao/piloto-ab.zip" \
  "/caminho/atrio-ota-piloto-ab.zip.age"
cd "$HOME/atrio-ota-homologacao"
unzip piloto-ab.zip
sha256sum base.apk candidate.apk
```

Compare os dois SHA-256 com o `hashes.json` e com o resumo do GitHub Actions. O ZIP possui `base.apk`, `candidate.apk`, `hashes.json` e `update-piloto-local.json`. **Nunca** publique os APKs descompactados, compartilhe a chave privada nem faça upload desses arquivos em um repositório público.

## 4. Teste no mesmo Android, sem desinstalar

Antes do ensaio, preserve seus dados essenciais por meio de um procedimento adequado **sem modificar o backup original**. Use conta de teste e registre que a versão A foi instalada sem perder preferências ou dados.

Instale `base.apk` **como atualização por cima**, se o Android aceitar pacote e assinatura, sem desinstalar o aplicativo existente. Se o Android recusar, **pare**: não limpe dados, não remova o aplicativo, não force o downgrade.

No Termux, com o código do repositório disponível:

```sh
cd "$HOME/caminho-do-repositorio"
python3 -m scripts.ota_release_pilot_server \
  --apk "$HOME/atrio-ota-homologacao/candidate.apk" \
  --validated-manifest "$HOME/atrio-ota-homologacao/update-piloto-local.json" \
  --candidate-sha256 SHA256_DO_CANDIDATE_APK \
  --base-code 36
```

Abra o **Átrio (versão-base A)**, acesse **Perfil → Atualizações**, consulte e baixe a versão B pelo aplicativo, conceda apenas as permissões de instalação solicitadas pelo Android e confirme o instalador do sistema. Depois de reiniciar, confira `versionCode=37`, sessão autenticada e dados locais. A instalação **não** é silenciosa; o usuário decide.

Execute também os testes de recusa de atualização e registre evidências sanitizadas. Consulte o roteiro `docs/qa-homologacao/OTA_RELEASE_PILOTO_LOCAL.md`.

## Limites antes da liberação oficial

Esta execução comprova, no máximo, assinatura e entrega controlada dos **candidatos**. Não comprova a instalação física, a preservação da sessão nem a validade do canal público do GitHub Releases. O piloto usa loopback, **não** GitHub Releases estável: haverá necessidade de validação própria da distribuição após o ensaio local.

Nenhum GitHub Release é criado. Nenhuma configuração de Firebase, Cloudflare, keystore permanente, backup ou bloqueio de produção é alterada automaticamente. Mantenha a issue #149 aberta até a prova física e a autorização expressa e separada para lançamento.
