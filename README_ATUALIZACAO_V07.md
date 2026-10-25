# Átrio Católico v0.7 — Notificações e perfil

Esta versão mantém o identificador `br.com.atriocatolico`, as contas e as publicações do Firestore.

## O que mudou

- **Sino com contador** de respostas não lidas às discussões criadas por você.
- **Caixa de notificações dentro do app**, com acesso à discussão, marcar como lida e dispensar.
- **Apresentação do perfil** (biografia privada ao próprio usuário, até 180 caracteres).
- **Regras de segurança**: somente o destinatário lê o aviso; ele só é criado junto com uma resposta realmente gravada no mesmo batch, conferida por `getAfter()`.

**Limites:** não são notificações push do Android: elas aparecem ao abrir o app. A caixa lista até 100 avisos recentes. Somente discussões nas 100 publicações mais recentes são abertas diretamente; conteúdo antigo exibe um aviso, sem perda dos dados. Não implemente como serviço de moderação.

## 1. Atualize as regras Firebase (obrigatório)

1. Acesse https://console.firebase.google.com/project/atrio-catolico/firestore/rules
2. Substitua as regras vigentes pelo conteúdo COMPLETO de `firestore.rules` deste pacote, depois clique em **Publicar**.
3. Jamais use `allow read, write: if true`; mantenha o banco privado por usuário.
4. Faça isso antes de testar notificações ou biografia; caso contrário pode ocorrer `PERMISSION_DENIED`.

## 2. Atualize o projeto pelo celular

Baixe `atrio_catolico_patch_v07.zip` e execute no Termux:

```sh
cd ~/atrio
unzip -o ~/storage/downloads/atrio_catolico_patch_v07.zip -d .
git add app/src/main/java/br/com/atriocatolico/MainActivity.kt app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt app/build.gradle.kts firestore.rules README_ATUALIZACAO_V07.md CHANGELOG.md
git commit -m 'Atrio Catolico v0.7 notificacoes e perfil'
git push origin main
```

Acompanhe https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions
Se estiver verde, abra o artifact `atrio-catolico-firebase-apk`, extraia `app-debug.apk` e instale. Para atualizar sobre app anterior, a assinatura precisa ser compatível; se não for, desinstale a versão de testes atual primeiro. Dados do Firebase permanecerão, mas dados locais podem ser perdidos.

## 3. Teste com duas contas

1. Conta A cria uma discussão nova.
2. Conta B responde a essa discussão.
3. Conta A abre o sino: aviso da resposta e contador deverão aparecer.
4. Conta A marca como lida e abre a discussão.
5. Conta B responde novamente; conta A vê novo aviso.
6. Conta A abre Perfil e preenche a própria apresentação.
7. Conta B não deve receber notificações de respostas publicadas por ela mesma.

## Alertas técnicos

- Esse pacote foi inspecionado estaticamente. A compilação APK e o teste entre contas dependem da sua execução GitHub Actions e Firebase.
- Alterar o arquivo `firestore.rules` no GitHub não atualiza as regras ativas do Firebase.
- Regras Firestore `getAfter` aplicam limites de acessos e podem consumir leituras cobradas.
- Não há push com FCM, limpeza recursiva de subcoleções ou painel de moderação nesta versão.
