# Átrio Católico 0.8.0 — Discussões e salvos

Atualização incremental sobre a versão 0.7.0. Mantém contas, pacote Android,
configuração Firebase e dependências já utilizadas. Não contém APK pronto.

## Mudanças
- Ao abrir uma publicação, o aplicativo consulta seu documento diretamente.
  Notificações abrem discussões existentes mesmo fora do feed carregado.
- O detalhe exibe o texto completo. Os cartões do feed continuam resumidos.
- Feed: 30 publicações iniciais e botão para carregar mais 30 por vez.
- Respostas: 30 iniciais (das mais antigas às mais recentes), com mais 30 por vez.
- Salvos: documentos consultados por identificador, em ordem de salvamento mais
  recente, com mais 30 itens por vez; independem do feed.
- Indicadores de carregamento, tentativa após falhas e aviso de discussão removida.
- Estados de tela são reiniciados ao trocar de conta; consultas de detalhes e
  salvos são encerradas quando deixam de ser necessárias.

## Instalação pelo Termux
Salve este ZIP em Downloads com o nome atrio_catolico_patch_v08.zip.
No Termux, execute:

```sh
cd ~/atrio
unzip -o ~/storage/downloads/atrio_catolico_patch_v08.zip -d .
git add app/src/main/java/br/com/atriocatolico/MainActivity.kt app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt app/build.gradle.kts CHANGELOG.md README_ATUALIZACAO_V08.md
git commit -m "Atrio Catolico 0.8: discussoes antigas e salvos"
git push origin main
```

Acompanhe:
https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions

Depois do sucesso, baixe o artefato atrio-catolico-firebase-apk, extraia e instale
app-debug.apk. Se houver conflito de assinatura, não desinstale imediatamente:
confirme que conhece suas credenciais e que os dados desejados estão sincronizados.
Uma desinstalação apaga dados locais; não apaga os documentos já salvos no Firebase.

## Firebase
As regras da 0.7 permanecem exatamente iguais. Se já estão publicadas e funcionando,
não é necessário alterá-las. Nenhum índice composto novo é necessário para estas
consultas. A atualização do código no GitHub não publica regras no Firebase.

## Testes no Android
1. Abra uma discussão com texto maior que cinco linhas. Confirme a leitura até o fim.
2. Salve uma discussão antiga que esteja fora das primeiras 30 publicações.
   Reabra o aplicativo, vá a Salvos e confirme que consegue abrir, curtir e responder.
3. Pela segunda conta, responda a uma discussão antiga da primeira conta.
   Na primeira conta, abra o aviso no sino e confirme que a discussão abre.
4. Com mais de 30 publicações, use Carregar mais publicações. Confirme a ordem,
   a ausência de duplicação e a continuidade depois de 100 publicações.
5. Em uma discussão com mais de 30 respostas, use Carregar mais respostas.
   Confirme a continuidade depois de 100 respostas. Não crie mensagens de teste
   em massa na comunidade real: use um ambiente de teste para esses volumes.
6. Com mais de 30 salvos, carregue os seguintes. Remova um salvo e confira a lista.
7. Exclua uma publicação de teste que tenha uma notificação. Abrir esse aviso deve
   informar que a discussão foi removida, sem mostrar uma discussão diferente.
8. Teste edição/exclusão próprias, biografia, sair e entrar com a outra conta.
9. Desative temporariamente a conexão e reative. Confira a recuperação das telas;
   dados já armazenados em cache podem continuar visíveis offline.

## Validação feita e limites
- Leitura e comparação com o projeto completo e patch 0.7 enviados.
- Análise sintática dos dois arquivos Kotlin, sem erros detectados pelo parser.
- Verificador local de configuração Firebase aprovado.
- Revisão das mudanças de consultas, identidade de conta, autoria e descarte de listeners.
- Integridade do ZIP e conferência dos arquivos incluídos.
- Não houve compilação Android nem execução em dispositivo/emulador neste ambiente.
  Análise sintática não substitui a compilação, a resolução de tipos ou testes reais.

O carregamento usa uma janela crescente de consulta em tempo real (30, 60, 90...)
com um registro adicional para detectar se há mais. Não é paginação por cursor;
reabrir a consulta pode reler registros e aumentar leituras do Firestore.
Os documentos salvos visíveis têm listeners individuais, encerrados ao sair da lista.
A lista de identificadores salvos e curtidos continua sendo carregada inteira.
A busca e as contagens dos fóruns e do perfil ainda se referem ao feed carregado.
A central continua limitada aos 100 avisos mais recentes. Notificações push,
moderação e limpeza de respostas órfãs não fazem parte desta atualização.

Referências técnicas consultadas:
https://firebase.google.com/docs/reference/kotlin/com/google/firebase/firestore/Query
https://firebase.google.com/docs/firestore/query-data/listen?hl=pt-br
