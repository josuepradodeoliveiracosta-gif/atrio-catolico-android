# Átrio Católico 0.5 — Atualização incremental

Este pacote continua o projeto Android anterior; preserve o mesmo package name `br.com.atriocatolico` e o Firebase existente.

## O que mudou

- Corrige o cabeçalho do feed e tela de login para respeitarem a barra de status do Android.
- Mantém o Firebase, discussões, respostas, curtidas, salvos e denúncias anteriores.
- Adota as versões de Gradle/Kotlin/Compose que tiveram sucesso na compilação GitHub Actions #5.
- Atualiza versionCode para 5 e versionName para 0.5.0.

## Atualização pelo Termux

1. Baixe `atrio_catolico_patch_v05.zip` para a pasta Downloads.
2. Cole no Termux:

```sh
cd ~/atrio
unzip -o ~/storage/downloads/atrio_catolico_patch_v05.zip -d .
git status --short
git add app/build.gradle.kts app/src/main/java/br/com/atriocatolico/MainActivity.kt app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt .github/workflows/build-apk.yml README_ATUALIZACAO_V05.md
git commit -m "Atualizar Atrio Catolico 0.5 interface"
git push origin main
```

Não execute `git init` novamente. Não sobrescreva `app/google-services.json` nem altere o projeto Firebase.

## Instalação do APK

Baixe o artefato na execução mais recente em GitHub > Actions. A assinatura de debug gerada em diferentes máquinas/execuções pode variar. Se a atualização indicar conflito de assinatura, desinstale primeiro o APK de testes anterior e depois instale o novo (dados do aplicativo local serão perdidos, mas as publicações e perfis que estão no Firebase permanecem). Uma distribuição pública exigirá assinatura estável de release e testes adicionais.

## Limitações

A compilação ainda não foi executada neste ambiente. Valide o build no GitHub e confira a interface no aparelho. Os botões de notificações continuam demonstrativos. As denúncias exigem análise manual no Firebase Console. Não é uma versão pronta para divulgação pública.
