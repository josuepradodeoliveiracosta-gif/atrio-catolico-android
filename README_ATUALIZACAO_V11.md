# Átrio Católico 0.11.0 — Vídeo de abertura

Pacote de código para atualizar o projeto 0.9/0.10 pelo Termux e gerar o APK pelo GitHub Actions.
Inclui também o código de denúncias de respostas da versão 0.10.
Nenhuma alteração foi feita automaticamente no GitHub ou no Firebase real.

## Comportamento
- Inclui exatamente o vídeo 1000084308.mp4 enviado: cerca de 10 segundos, 1280×720,
  H.264/AAC, 3.378.959 bytes. Sem recorte, sem recompressão e sem upload para Storage.
- O vídeo funciona sem internet. A instalação aumenta aproximadamente pelo tamanho do vídeo.
- Exibe o pop-up uma vez por nova tarefa de abertura do app, inclusive antes do login.
- Botão Fechar e botão Voltar do Android encerram a janela e a reprodução.
- Começa sem som, com botão Ativar som. Fecha automaticamente ao terminar.
- Alternar aplicativos ou navegar entre telas não abre outro pop-up. Ao ficar em segundo
  plano, a reprodução pausa; se ainda estava aberta, continua ao retornar.
- Fechar o app pelo Voltar da tela principal ou removê-lo dos recentes e abri-lo novamente
  inicia uma nova sessão e exibe novamente. Tocar no ícone enquanto o app ainda está nos
  recentes pode apenas trazer a mesma sessão para frente: isso não é uma nova abertura.
- Rotação e restauração da mesma tarefa preservam o estado de fechamento.
- Erro de reprodução fecha o pop-up. Há limite de 8 segundos para preparação do vídeo.
- A tela principal não fica bloqueada enquanto se consulta a configuração inicial (até 1,2 s).

## 1. Regras Firestore
Abra https://console.firebase.google.com/project/atrio-catolico/firestore/rules
Substitua o conteúdo completo por atrio_catolico_firestore_rules_v11.txt e publique.
O mesmo conteúdo está no arquivo firestore.rules do ZIP.
Não altere as regras do Storage: ele não é utilizado para este vídeo.

A única configuração pública é app_config/opening_video: permite leitura direta mesmo
antes do login. Não coloque dados privados nesse documento. Listagem da coleção e
escritas por clientes são bloqueadas, inclusive para administradores do aplicativo.
Alterações devem ser feitas pelo proprietário do projeto no Console ou Admin SDK autorizado.
As regras anteriores de contas, publicações, respostas, denúncias e moderação foram preservadas.

## 2. Controle da exibição no Console
Em Firestore Database > Dados, na RAIZ do banco:
1. Clique em Iniciar coleção (ou abra a coleção se já existir).
2. ID da coleção: app_config
3. ID do documento: opening_video (não escolha ID automático).
4. Campo: enabled; tipo: boolean; valor: true.
5. Salve.

Para desligar: edite enabled para false. Para religar: true.
Não use texto "true" ou "false": o tipo precisa ser boolean.
Não é necessário campo de URL, videoId ou enviar o vídeo ao Firestore.
O vídeo é fixo no APK; trocar seu conteúdo exige outra versão.

Sem configuração, o padrão desta versão é exibir o vídeo. Configuração inválida/ausente
recebida do servidor também restaura esse padrão. Por isso, desligue com false, não apagando.
Sem internet ou sem permissão de leitura, usa a última opção recebida, ou true se nunca
sincronizou. Uma desativação remota só é aplicada quando o celular recebe a mudança.
Se a configuração chegar desativada enquanto o vídeo estiver aberto, a janela fecha.
Religar durante uma sessão já encerrada não interrompe a navegação: vale na próxima abertura.
Sua autorização admins/UID não precisa ser recriada.

## 3. Aplicar no Termux
Salve atrio_catolico_patch_v11.zip em Downloads e execute:

```sh
cd ~/atrio
unzip -o ~/storage/downloads/atrio_catolico_patch_v11.zip -d .
git add app/src/main/java/br/com/atriocatolico/MainActivity.kt app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt app/src/main/java/br/com/atriocatolico/ModerationScreen.kt app/src/main/java/br/com/atriocatolico/OpeningVideo.kt app/src/main/res/raw/abertura_atrio.mp4 app/build.gradle.kts firestore.rules CHANGELOG.md README_ATUALIZACAO_V11.md tests/security
git commit -m "Atrio Catolico 0.11: video de abertura"
git push origin main
```

Acompanhe https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions
Quando passar, baixe e extraia o artefato e instale app-debug.apk.
O ZIP não é um APK. Não contém google-services.json e preserva sua configuração.
Nenhuma dependência Android nova foi adicionada: utiliza o VideoView nativo.

## 4. Verificação no celular — obrigatória após compilar
1. Com enabled=true, abra o aplicativo: imagem inteira, sem som, botão Fechar disponível.
2. Ative o som, feche antes do fim e confirme que o áudio para.
3. Navegue, saia para outro aplicativo e volte: não deve aparecer novamente.
4. Remova o app dos recentes e abra: deve mostrar novamente.
5. Deixe terminar: deve fechar automaticamente após cerca de 10 segundos.
6. Durante o vídeo, alterne aplicativos: deve pausar e continuar ao retornar.
7. Gire o celular, tanto durante a reprodução quanto depois de fechar: não deve criar
   outra sessão nem reaparecer depois de fechado. Confira o tamanho do botão e do vídeo.
8. Altere enabled=false no Console com internet ativa. Confira que fecha se estiver
   aberto e que não aparece nas próximas aberturas, inclusive sem internet após sincronizar.
9. Reative true, mantenha o app conectado para sincronizar, encerre e reabra.
10. Confira login, denúncias de publicações/respostas e moderação da versão anterior.

## Validação local
Relatório de regras em tests/security/RESULTADO.txt. Testes em projeto fictício demo-atrio-v11,
sem acesso ao banco real. Para repetir: cd tests/security; npm ci; npm test.
Também foram verificadas sintaxe Kotlin, configuração Firebase, decodificação integral do
vídeo, igualdade do vídeo empacotado com o original e integridade do ZIP.
Compilação Android, tipos Kotlin e comportamento visual/em dispositivo ainda dependem
na prática do GitHub Actions e do teste no celular: análise sintática não os substitui.

Referências de implementação:
https://developer.android.com/reference/android/widget/VideoView
https://developer.android.com/develop/ui/compose/state-saving
