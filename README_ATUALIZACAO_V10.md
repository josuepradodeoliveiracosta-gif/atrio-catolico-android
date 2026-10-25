# Átrio Católico 0.10.0 — Denúncias de respostas

Atualização sobre 0.9.0. Este pacote contém código e regras, não um APK.
Seu repositório remoto e seu Firebase não foram alterados por este pacote.

## Novidades
- Botão Denunciar em cada resposta, com autor, texto completo e motivo.
- Painel distingue denúncias de publicação e de resposta.
- Administrador lê a resposta e o título da discussão antes de decidir.
- Pode encerrar sem remover ou remover somente a resposta denunciada.
- Remoção e registro da decisão ocorrem juntos. Discussão e demais respostas permanecem.
- Justificativa obrigatória, decisão imutável pelo aplicativo e confirmação da exclusão.
- Denúncias antigas de publicações continuam compatíveis.

## 1. Publique as regras — obrigatório
Abra https://console.firebase.google.com/project/atrio-catolico/firestore/rules
Substitua TODO o conteúdo pelo arquivo atrio_catolico_firestore_rules_v10.txt e publique.
O mesmo conteúdo está em firestore.rules dentro do ZIP.
Atualizar o arquivo no GitHub não publica as regras no Firebase.

Seu documento admins/UID com enabled boolean true continua válido. Não precisa recriá-lo.
Atualize o APK de todos os administradores antes de analisar denúncias de respostas.
As regras bloqueiam decisões de clientes antigos que confundam resposta com publicação.

## 2. Atualize pelo Termux
Baixe atrio_catolico_patch_v10.zip em Downloads e execute:

```sh
cd ~/atrio
unzip -o ~/storage/downloads/atrio_catolico_patch_v10.zip -d .
git add app/src/main/java/br/com/atriocatolico/MainActivity.kt app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt app/src/main/java/br/com/atriocatolico/ModerationScreen.kt app/build.gradle.kts firestore.rules CHANGELOG.md README_ATUALIZACAO_V10.md tests/security
git commit -m "Atrio Catolico 0.10: denuncias de respostas"
git push origin main
```

Acompanhe https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions
Após a compilação passar, baixe e extraia o artefato e instale app-debug.apk.
O pacote Android e as dependências continuam os mesmos.
O ZIP não inclui google-services.json e preserva sua configuração existente.

## 3. Teste no celular
Use somente conteúdo criado para teste e duas contas.
1. Na conta A, crie uma discussão de teste.
2. Na conta B, sem cargo administrativo, publique duas respostas diferentes.
3. Na conta A, denuncie uma resposta com um motivo de pelo menos cinco caracteres.
4. Em Perfil > Moderação — denúncias, abra a denúncia de resposta. Confira autor,
   texto e discussão. Encerre sem remover e confira que ambas as respostas continuam.
5. Denuncie novamente a mesma resposta. Abra a nova denúncia na moderação,
   escreva uma justificativa e confirme Remover resposta.
6. Confira que somente a resposta escolhida desapareceu: a discussão e a segunda
   resposta devem permanecer. A decisão deve aparecer em Analisadas.
7. Confira que a conta B não tem acesso à moderação.
8. Teste também denúncia de publicação, comentários, avisos, salvos e edição própria.

Se a resposta já tiver sido apagada pelo autor, encerre a denúncia sem remoção,
registrando esse motivo. Outras denúncias do mesmo conteúdo são analisadas individualmente.

## Verificações e limites
- 61 testes aprovados no emulador Firestore, usando projeto fictício demo-atrio-v10.
  Nenhum teste acessou seu banco real. O relatório está em tests/security/RESULTADO.txt.
- Cobertura: acesso, autoria, privacidade, denúncias inválidas, decisões imutáveis,
  revogação, compatibilidade com publicações, exclusão exata da resposta, preservação
  da discussão e bloqueio de remoção incorreta por cliente antigo.
- Análise sintática dos três arquivos Kotlin e verificação local da configuração Firebase aprovadas.
- Compilação Android e teste visual no celular ainda dependem do GitHub Actions e da instalação.
- Não inclui banimento, filtros automáticos, push, restauração ou limpeza recursiva.
- Notificações e referências de conteúdo apagado podem continuar armazenadas.
- O registro da decisão não guarda cópia integral do conteúdo excluído.
- Excluir uma publicação mantém a limitação anterior: subcoleções não são apagadas automaticamente.

Para repetir os testes com Node e Java:
```sh
cd tests/security
npm ci
npm test
```
As ferramentas de teste não são dependências do APK.
