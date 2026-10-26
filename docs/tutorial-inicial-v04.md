# Átrio Católico — APK pelo celular Android (versão 0.4)

Este pacote prepara o projeto nativo Android Kotlin/Jetpack Compose/Firebase para compilar por **GitHub Actions**, usando **somente o celular**.

**Projeto Firebase:** `atrio-catolico` | **Aplicativo Android:** `br.com.atriocatolico`

## Tutorial rápido no Android

1. Crie uma conta em https://github.com e faça login no Chrome.
2. Instale Termux pela página oficial https://f-droid.org/packages/com.termux/ .
3. Salve o ZIP deste projeto na pasta Downloads do celular.
4. No Termux, rode:

```sh
pkg update -y && pkg install -y git gh unzip
termux-setup-storage
mkdir -p ~/atrio && cd ~/atrio
unzip -o ~/storage/downloads/atrio_catolico_android_github_v04.zip
gh auth login --web
```

Em `gh auth login`, selecione **GitHub.com**, **HTTPS**, **Login with a web browser**. Copie o código que aparecer, autorize no navegador e volte ao Termux.

5. No Termux, execute:

```sh
cd ~/atrio
bash scripts/publicar_github_termux.sh
```

Esse script cria um **repositório privado** chamado `atrio-catolico-android`, envia os arquivos e dispara a compilação pela atualização de `main`.

6. No Chrome, vá a `https://github.com/SEU_USUARIO/atrio-catolico-android/actions`, abra a execução do workflow **Gerar APK do Atrio Catolico**, veja se ficou verde e baixe o artefato **atrio-catolico-firebase-apk**. Ele é um ZIP; extraia para obter `app-debug.apk`.
7. Abra o APK em Downloads e autorize instalar de fonte desconhecida para o gerenciador de arquivos usado.
8. Crie uma conta de testes no Átrio Católico e confira publicações. Para validar sincronização, repita com outra conta.

## Segurança

O arquivo `app/google-services.json` é configuração de cliente Android, que fica embutida no APK. Não é uma chave privada de administrador. Ainda assim, o projeto é criado como **repositório privado** e requer regras Firestore seguras. **Não publique arquivos de contas de serviço ou credenciais administrativas.**

O ZIP **não é um APK**. A compilação no GitHub ainda não foi executada nem validada com um aparelho real. Eventuais erros aparecerão na aba Actions. O APK de testes é assinado com chave de depuração; não está pronto para publicar na Play Store.

## Arquivos principais

- `.github/workflows/build-apk.yml` — build automático do APK em cada push na branch `main`.
- `scripts/publicar_github_termux.sh` — publicação inicial segura como repo privado.
- `app/google-services.json` — configuração Firebase fornecida pelo proprietário.
- `app/src/main/java/br/com/atriocatolico/` — código do app.
- `firestore.rules` — cópia das regras de segurança, a publicar separadamente no Firebase se necessário.
