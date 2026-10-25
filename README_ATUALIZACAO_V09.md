# Átrio Católico 0.9.0 — Moderação

Atualização sobre 0.8.0, preservando as funções anteriores. Inclui código e regras;
não é um APK. Não houve alteração no seu repositório remoto nem no seu Firebase.

## O que a moderação permite
No Perfil do administrador aparece “Moderação — denúncias”. A área exibe as
30 denúncias mais recentes e permite carregar mais, com filtros de pendentes e
analisadas aplicados aos registros carregados. Denúncias antigas sem status são
consideradas pendentes. Ao abrir, são exibidos motivo e conteúdo atual completo.

O administrador pode:
- Encerrar sem remover: registra a justificativa e mantém a publicação.
- Remover publicação: exige justificativa e confirmação. A exclusão e a decisão
  são gravadas juntas em transação. Se o autor alterar o conteúdo depois de a
  confirmação ser aberta, a operação é recusada e é necessário rever o conteúdo.

A decisão registra status, UID do administrador, data do servidor e justificativa.
Esses campos não podem ser reeditados e a denúncia não pode ser apagada pelo app.
O Console/Admin SDK autorizado continua capaz de administrar o banco.

## 1. Publicar as regras novas — obrigatório
Abra https://console.firebase.google.com/project/atrio-catolico/firestore/rules
Substitua TODO o conteúdo pelas regras de firestore.rules deste pacote (também
fornecidas separadamente como atrio_catolico_firestore_rules_v09.txt) e publique.
As regras mantêm o acesso existente e acrescentam a autorização de moderação.
Atualizar apenas o arquivo no GitHub NÃO publica regras no Firebase.

## 2. Autorizar sua conta — uma vez
1. Abra https://console.firebase.google.com/project/atrio-catolico/authentication/users
2. Localize pelo e-mail a conta com que você entra no Átrio.
3. Copie o UID dessa conta. Não use e-mail nem nome como identificador.
4. Abra Firestore Database > Dados.
5. Na raiz do banco, inicie a coleção chamada exatamente admins.
6. No ID do documento, cole exatamente o UID copiado. Não escolha ID automático.
7. Adicione o campo enabled, do tipo boolean (booleano), com valor true.
8. Salve. Não crie esse documento dentro de profiles ou users.

Estrutura esperada:
- Coleção raiz: admins
- Documento: UID exato da sua conta
- Campo: enabled
- Tipo: boolean
- Valor: true

Ninguém, nem um administrador do aplicativo, pode criar ou alterar esses documentos
pelo cliente. A concessão é feita somente pelo Console/Admin SDK com acesso ao projeto.
Nunca abra as regras para permitir gravação na coleção admins.
Para revogar, mude enabled para false no Console ou remova o documento de acesso.
A interface acompanha o documento; o servidor revalida a permissão nas operações.
Não é preciso compartilhar senha, token ou chave de serviço para configurar isso.

## 3. Atualizar pelo Termux
Salve atrio_catolico_patch_v09.zip em Downloads. Execute:

```sh
cd ~/atrio
unzip -o ~/storage/downloads/atrio_catolico_patch_v09.zip -d .
git add app/src/main/java/br/com/atriocatolico/MainActivity.kt app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt app/src/main/java/br/com/atriocatolico/ModerationScreen.kt app/build.gradle.kts firestore.rules CHANGELOG.md README_ATUALIZACAO_V09.md tests/security
git commit -m "Atrio Catolico 0.9: moderacao de denuncias"
git push origin main
```

Acompanhe https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions
Quando a compilação tiver sucesso, baixe o artefato, extraia e instale app-debug.apk.
Se houver conflito de assinatura, confirme suas credenciais e sincronização antes
 de desinstalar a versão anterior: uma desinstalação apaga dados locais.
O projeto mantém br.com.atriocatolico e as dependências da versão anterior.

## 4. Teste prático com duas contas
Use somente publicações criadas para o teste.
1. Conta B, sem acesso administrativo, cria uma publicação de teste.
2. Conta A envia uma denúncia pela opção Denunciar discussão.
3. Conta A, autorizada em admins, abre Perfil > Moderação — denúncias.
4. Abra a denúncia, leia a publicação e encerre sem remover, com justificativa.
   Confira que foi para Analisadas e que a publicação continua no fórum.
5. Envie uma nova denúncia da publicação de teste. Pela moderação, preencha a
   justificativa, toque em Remover publicação e confirme.
6. Verifique na conta B que a publicação desapareceu e na conta A que a denúncia
   ficou registrada como removida.
7. Conta B não deve exibir o botão de moderação.
8. No Console, desative temporariamente enabled da conta A: o acesso deve sumir
   após a sincronização. Reative para continuar administrando.
9. Confira cadastro/login, comentários, avisos, salvos, biografia e texto completo.

Se o botão não aparecer: confira o APK 0.9, as regras publicadas, o UID exato,
a coleção raiz admins e o tipo boolean de enabled. Feche e reabra o app conectado.

## Limites desta versão
- Modera publicações denunciadas; não inclui banimento de contas, denúncias de
  respostas, filtros automáticos, notificações push ou restauração pelo aplicativo.
- Excluir uma publicação NÃO faz limpeza recursiva: respostas, salvos e notificações
  relacionados podem permanecer armazenados. Isso já ocorria na versão anterior.
- As respostas órfãs seguem as permissões existentes. Sua limpeza administrativa
  e o endurecimento dessas regras são trabalho separado.
- Outras denúncias da mesma publicação permanecem pendentes e podem ser encerradas
  individualmente, com a justificativa de que o conteúdo já foi removido.
- O registro da decisão não guarda cópia integral do conteúdo excluído.
- Administradores podem remover publicações, mas não editar textos alheios,
  consultar perfis privados de outros membros ou conceder cargos pelo app.
- As permissões de usuário normal são mantidas: autores continuam editando ou
  removendo seu próprio conteúdo conforme as regras já existentes.

## Verificações realizadas
- 28 testes aprovados no emulador Firestore, com projeto fictício demo-atrio-v09;
  nenhum teste leu ou alterou seu banco real.
- Casos: bloqueio de anônimos, privacidade das denúncias, autopromoção recusada,
  acesso administrativo, autoria, justificativa, identidade do revisor, decisão
  imutável, exclusão atômica, revogação e regressão de resposta/notificação.
- Análise sintática dos três arquivos Kotlin e verificação local de configuração Firebase.
- Comparação do escopo da atualização e integridade do ZIP.
- Compilação Android e teste visual/em dispositivo ainda pendentes no GitHub/celular.

Para repetir os testes em um ambiente de desenvolvimento com Node e Java:
```sh
cd tests/security
npm ci
npm test
```
O teste usa emulador local e ID demo; não aponta para seu projeto real.
Ferramentas de teste não são incluídas como dependências do aplicativo Android.

Referências oficiais consultadas:
https://firebase.google.com/docs/firestore/security/rules-conditions
https://firebase.google.com/docs/firestore/security/test-rules-emulator
