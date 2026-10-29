# Perfis públicos (proposta Debug 0.19.6)

## Escopo
- Toque no autor/avatar de discussões no feed, salvos e cabeçalho da discussão.
- Toque no nome/avatar de cada resposta, preservando o gesto prolongado das reações.
- Tela de perfil público com nome, selos existentes, apresentação **publicada voluntariamente** e discussões carregadas por páginas de 20, em ordem decrescente de criação.
- Navegação de volta para perfil e discussão de origem; ao abrir uma discussão do perfil, o botão Voltar retorna ao perfil, e depois à tela anterior.
- Contagem na tela é **apenas de discussões carregadas**, não total histórico. Não há contagem global de respostas: exigiria agregação confiável fora do cliente.
- Fotos dos demais continuam exibindo avatar com inicial: a foto atual é guardada **somente no aparelho do proprietário**, sem URL remota confiável.

## Privacidade
- **Nunca** abrir o documento privado `profiles/{uid}` de outro usuário. As regras continuam `allow get: if me(uid)`.
- `public_profiles/{uid}` é uma coleção separada, de consulta por ID apenas para autenticados; proíbe listagem e acesso anônimo.
- Só o próprio membro pode publicar/atualizar/excluir sua apresentação. Regras conferem que nome, bio e data de entrada coincidam com os valores do documento privado (e bloqueiam chaves adicionais como e-mail, telefone, selos e tokens).
- A bio privada existente **não** se torna pública automaticamente; o titular precisa tocar em **Publicar minha apresentação**. O botão **Retirar apresentação pública** apaga a projeção.
- O editor grava o perfil privado e a projeção pública na **mesma transação**, somente quando a apresentação já estiver publicada. Se qualquer gravação falhar, nenhuma das duas alterações é confirmada. As regras com `getAfter` comparam a projeção ao estado final do perfil privado.
- **Compatibilidade:** APKs anteriores que atualizarem somente o perfil privado ainda podem deixar uma apresentação voluntariamente publicada desatualizada. Para atualização atômica, usar o APK Debug corrigido. É possível retirar a apresentação pelo botão de revogação.
- Se a coleção pública ainda não existir ou suas regras não estiverem aplicadas, a tela mostra o nome da publicação, selos e discussões, sem expor a bio.

## Implantação e índice: ainda não aprovados
**Nenhum deploy foi executado.** A consulta de 29/10/2026 via `firebase firestore:indexes --project atrio-catolico` retornou `indexes: []` e `fieldOverrides: []`: não havia índices compostos personalizados a preservar nesse momento. Reconsultar antes do deploy e usar somente o arquivo da branch revisada, não a pasta local antiga `atrio-regras-0194`.

Antes de ativar por completo em produção, revisar e publicar **separadamente**, mediante autorização do fundador:
1. `firestore.rules` para `public_profiles`.
2. `firestore.indexes.json`: índice composto `posts` (uid ASC, createdAt DESC).
3. Confirmar o índice pronto antes de considerar o histórico de perfis funcional para todos.

O APK Debug pode ser compilado em CI e testado no emulador com regras locais, mas **produção não terá a coleção pública habilitada nem o índice até o deploy**. Não escrever em produção por acesso administrativo, não executar migrações ou backfills sem autorização.

## Testes
- `tests/security/public-profile.test.mjs`: privacidade, tentativa de usurpação, dados extras, opt-in e retirada.
- `app/src/androidTest/java/br/com/atriocatolico/PublicMemberProfileUiTest.kt`: autores, respostas e ausência de edição de terceiros.
- Testes existentes de interações, selos e Firestore devem continuar aprovados.

## Limitações respeitadas
- Não houve alteração de backup, de assinatura, de Release oficial, nem implantação Firestore/Cloudflare.
- Os nomes provêm das publicações públicas, ou da projeção opt-in (se existente). Uma pessoa que nunca publicou nem foi citada por vínculo canônico não é localizável por busca global.
- Não se transforma texto livre com `@` em identidade: isso exigiria identificação canônica para evitar perfis errados.
- Testes automatizados e compilação não substituem validação física no Android.
