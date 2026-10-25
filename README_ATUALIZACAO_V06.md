# Átrio Católico 0.6 — Gestão de conteúdo e segurança

A versão 0.6 preserva `br.com.atriocatolico`, Firebase, autenticação, feed, fóruns e publicações existentes. Não mude o identificador do Firebase.

## Novidades

- Na tela de detalhes das **suas próprias discussões**, aparecem as ações **Editar discussão** e **Excluir discussão**.
- Edição de título (5–120 caracteres) e corpo (5–1200 caracteres); demais campos imutáveis.
- Botão **Excluir** aparece somente ao lado de uma resposta escrita pelo usuário atual.
- Confirmação obrigatória antes das exclusões, com feedback de sucesso/falha.
- Firestore Rules conferem `request.auth.uid` contra `resource.data.uid` no servidor e restringem campos editáveis.
- Versão Android alterada para `0.6.0` (`versionCode` 6).

## Publicar as regras no Firebase ANTES de testar a edição/exclusão

1. Após enviar este patch ao GitHub, abra o arquivo `firestore.rules` da branch `main` no navegador e use **Raw / Copiar** para copiar o texto completo.
2. Acesse https://console.firebase.google.com/project/atrio-catolico/firestore/rules
3. Substitua **todas** as regras antigas pelas do arquivo e toque em **Publicar**.
4. **Não** substitua as regras por `allow read, write: if true`. A atualização mantém a leitura só para usuários autenticados.
5. Sem esse passo, **editar e excluir falharão com `PERMISSION_DENIED`** (o feed continuará funcionando).

## Instalar com Termux

Coloque `atrio_catolico_patch_v06.zip` em Downloads e execute:

```sh
cd ~/atrio
unzip -o ~/storage/downloads/atrio_catolico_patch_v06.zip -d .
git add app/src/main/java/br/com/atriocatolico/MainActivity.kt app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt app/build.gradle.kts firestore.rules README_ATUALIZACAO_V06.md
git commit -m "Atrio Catolico v0.6 gestao de conteudo"
git push origin main
```

Acesse GitHub > Actions para baixar o APK de testes da nova execução. É necessária assinatura compatível para instalar por cima da versão anterior; se Android indicar assinatura diferente, desinstale a versão de testes anterior (dados locais serão perdidos). Publicações e perfis online continuam no Firebase.

## Plano de teste com duas contas

1. Conta A: publique, abra e edite uma discussão. Conta B: veja a alteração.
2. Conta A: exclua uma resposta sua; confira que desapareceu na conta B.
3. Conta B: confirme que **não** aparece a opção de editar ou excluir a discussão criada por A.
4. Conta A: exclua a discussão e confirme que sai do feed em ambas as contas.
5. Teste regras de segurança com o Rules Playground/Emulator antes de divulgar publicamente.

## Limitações importantes

- **Excluir uma discussão não exclui automaticamente documentos de sua subcoleção `replies`** nem referências em favoritos/curtidas. A exclusão recursiva segura requer rotina administrativa (por exemplo, Cloud Functions) em versão futura. Não represente essa remoção como eliminação completa de todos os dados pessoais.
- As denúncias continuam sujeitas a revisão manual, sem console de moderação.
- A publicação das regras no Firebase Console é manual; alterar o arquivo no GitHub por si só **não muda as permissões ativas**.
- A compilação deve ser confirmada no GitHub Actions; os testes estáticos feitos nesta entrega não substituem um build Android real.
