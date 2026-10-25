# Átrio Católico 0.12.0 — Vídeo após o login

Aplique sobre o projeto já atualizado para 0.11. O vídeo e as regras da v11 continuam iguais.
Este ZIP contém apenas os arquivos alterados, não o APK nem outra cópia do vídeo.

## Comportamento
- Nenhum pop-up na tela de login, cadastro ou recuperação de senha.
- Após autenticação bem-sucedida, exibe o vídeo se enabled estiver true.
- Cadastro que autentica automaticamente também permite a exibição.
- Quem já está conectado vê o vídeo ao iniciar uma nova tarefa do aplicativo.
- Fechar ou terminar o vídeo mantém a janela fechada durante a mesma sessão, inclusive
  se sair da conta e entrar novamente sem encerrar o app.
- Navegar, alternar aplicativos ou girar o celular não reinicia uma sessão encerrada.
- Remover dos recentes e abrir de novo permite outra exibição após autenticação.
- O modo de demonstração sem Firebase não mostra o vídeo, pois não tem autenticação real.
- Botão Fechar, som opcional, pausa em segundo plano e controle enabled foram mantidos.

## Instalação
1. A versão 0.11 deve estar aplicada no projeto, incluindo app/src/main/res/raw/abertura_atrio.mp4.
2. Não é preciso publicar novas regras nem recriar app_config/opening_video.
   Mantenha as regras v11 e o campo enabled (boolean) em true para exibir.
3. Baixe atrio_catolico_patch_v12.zip em Downloads e execute:

```sh
cd ~/atrio
unzip -o ~/storage/downloads/atrio_catolico_patch_v12.zip -d .
git add app/src/main/java/br/com/atriocatolico/MainActivity.kt app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt app/src/main/java/br/com/atriocatolico/OpeningVideo.kt app/build.gradle.kts CHANGELOG.md README_ATUALIZACAO_V12.md
git commit -m "Atrio Catolico 0.12: video apos login"
git push origin main
```

Acompanhe https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions
Quando passar, baixe o artefato e instale app-debug.apk.

## Teste no celular
1. Saia da conta, encerre o app e abra: o login deve ficar livre do vídeo.
2. Tente senha incorreta: o vídeo não deve aparecer.
3. Entre com as credenciais corretas: o vídeo deve aparecer após autenticação.
4. Feche o vídeo, navegue, alterne aplicativos, saia e entre na conta: não deve repetir
   nesta mesma sessão depois de já fechado.
5. Com a conta conectada, remova o app dos recentes e abra: deve mostrar novamente.
6. Com enabled=false sincronizado, confirme que não aparece após login ou nova abertura.

## Validação
Análise sintática dos quatro arquivos Kotlin e verificação de configuração Firebase aprovadas.
Confirmado por comparação que regras, vídeo e dependências não foram modificados.
Não houve nova execução dos testes Firestore: nenhuma regra mudou nesta atualização.
Compilação/tipos Kotlin e testes de interface ainda dependem do GitHub Actions e do celular.
Seu repositório remoto e seu banco não foram alterados por esta preparação.
