# Átrio Católico — assinatura Android permanente

## Situação atual

O arquivo de assinatura **já foi criado no Termux em outra etapa**, com localização pretendida
`$HOME/atrio-assinatura/atrio-release.jks` e alias `atrio`. **Não gere outra chave
sem primeiro verificar se esta ainda existe.**

O Gradle só configura a assinatura de **release** quando o workflow disponibiliza as
quatro variáveis `ATRIO_SIGNING_STORE_FILE`, `ATRIO_SIGNING_STORE_PASSWORD`,
`ATRIO_SIGNING_KEY_ALIAS`, `ATRIO_SIGNING_KEY_PASSWORD`.
O arquivo privado não faz parte deste repositório.

## 1. Verificar a chave no Termux

```bash
KEYSTORE="$HOME/atrio-assinatura/atrio-release.jks"
ls -l "$KEYSTORE"
keytool -list -v -keystore "$KEYSTORE" -alias atrio | grep -E 'Alias name:|Nome do alias:|SHA256:'
```

`keytool` solicita a senha do arquivo (nada aparece enquanto você digita).
**Não envie senhas, prints das senhas ou o arquivo .jks para o chat.**
Se a chave não existir, pare e localize a cópia original antes de criar outra.

## 2. Preservar a chave fora do celular

Guarde uma cópia criptografada do `atrio-release.jks`, as senhas e o alias em local
seguro **fora do repositório**. Sem a chave e a senha corretas, não será possível
assinar futuras atualizações com o mesmo certificado.

## 3. Enviar somente secrets criptografados ao GitHub a partir do Termux

```bash
REPO='josuepradodeoliveiracosta-gif/atrio-catolico-android'
KEYSTORE="$HOME/atrio-assinatura/atrio-release.jks"

# O conteúdo segue por stdin e não aparece no terminal nem no histórico do shell.
base64 < "$KEYSTORE" | tr -d '\n' | gh secret set ATRIO_KEYSTORE_BASE64 -R "$REPO"

# A senha digitada fica oculta e somente entra no secret, não no repositório.
read -r -s -p 'Senha do arquivo JKS: ' SENHA_STORE; printf '\n'
printf '%s' "$SENHA_STORE" | gh secret set ATRIO_STORE_PASSWORD -R "$REPO"
unset SENHA_STORE

read -r -s -p 'Senha do alias atrio: ' SENHA_KEY; printf '\n'
printf '%s' "$SENHA_KEY" | gh secret set ATRIO_KEY_PASSWORD -R "$REPO"
unset SENHA_KEY

gh secret list -R "$REPO"
```

Se a senha da chave e a senha do arquivo forem iguais, informe essa mesma senha
nos dois prompts. O alias é fixo: `atrio`.

O GitHub Actions guarda os valores criptografados, não os mostra em logs e
usa a chave somente durante a compilação de release.

## 4. Ativar a integração no GitHub

A proposta de assinatura está na branch
`feature/assinatura-permanente-2026-10-25`.
Depois de conferir a chave e gravar os três secrets, revise e integre o pull request
dessa branch em `main`. A integração não modifica o backup
`backup/v0.12.0-2026-10-25`.

O build gera dois artefatos separados:

- `atrio-catolico-firebase-apk`: APK *debug*, para testes, com assinatura temporária
  da máquina de compilação.
- `atrio-catolico-release-assinado`: APK *release*, assinado com sua chave
  `atrio-release.jks`. Utilize **este** para atualizações futuras.

Se nenhum secret estiver presente, a compilação de debug continua e a release
é ignorada. Se houver apenas parte deles, o build falha de propósito para
sinalizar configuração incompleta.

## 5. Migração da instalação antiga

O APK 0.12 que você instalou anteriormente provavelmente foi assinado
com uma chave **debug diferente**. O Android exige o mesmo identificador
(`br.com.atriocatolico`), certificado compatível e `versionCode`
igual ou superior para permitir instalar por cima.

**Pode ser necessária uma única desinstalação** para migrar de debug a release.
Antes disso, confirme e-mail e senha do Firebase e salve dados que existam
somente localmente. Os documentos armazenados no Firebase não são apagados ao
desinstalar o aplicativo, mas dados locais são.

Após instalar uma vez o APK assinado permanentemente, novas versões **release**
poderão atualizar por cima, desde que usem a mesma chave, pacote e versionCode
não inferior.

## Segurança e limites

- Nunca adicione o `.jks` ou senhas ao GitHub, mesmo em repositório privado.
- Não envie uma chave de assinatura pelo chat.
- Os secrets do Actions não substituem o seu backup offline do `.jks`.
- A configuração está proposta, mas só será comprovada após o build de
  `assembleRelease` e a validação do certificado no Android.
- Chave de assinatura **não é** a mesma coisa que `google-services.json`
  ou a configuração de autenticação do Firebase.
