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
- **Compatibilidade e privacidade:** as regras revisadas **bloqueiam edição isolada do perfil privado** quando já houver apresentação pública publicada. Isso impede que APKs antigos deixem uma bio pública obsoleta. Nessa situação, utilizar o APK Debug corrigido para editar ambos os documentos atomicamente, ou retirar antes a apresentação pelo aplicativo novo. Após a retirada, a edição privada volta a ser permitida.
- Se a coleção pública ainda não existir ou suas regras não estiverem aplicadas, a tela mostra o nome da publicação, selos e discussões, sem expor a bio.

## Implantação e índice: ainda não aprovados
**Nenhum deploy foi executado.** A consulta de 29/10/2026 via `firebase firestore:indexes --project atrio-catolico` retornou `indexes: []` e `fieldOverrides: []`: não havia índices compostos personalizados a preservar nesse momento. Reconsultar antes do deploy e usar somente o arquivo da branch revisada, não a pasta local antiga `atrio-regras-0194`.

Antes de ativar por completo em produção, revisar e publicar **separadamente**, mediante autorização do fundador:
1. `firestore.rules` para `public_profiles`.
2. `firestore.indexes.json`: índice composto `posts` (uid ASC, createdAt DESC).
3. Confirmar o índice pronto antes de considerar o histórico de perfis funcional para todos.

O APK Debug pode ser compilado em CI e testado no emulador com regras locais, mas **produção não terá a coleção pública habilitada nem o índice até o deploy**. Não escrever em produção por acesso administrativo, não executar migrações ou backfills sem autorização.

## Preparação segura — SEM deploy (Termux)

1. Utilize uma **cópia limpa** do repositório na branch `feature/perfis-publicos-0196`, distinta da antiga pasta `~/atrio-regras-0194`. Não copie versões antigas de `firestore.rules` sobre a PR.
2. O verificador `bash scripts/preparar_firestore_perfis_0196.sh` **somente lê** os arquivos locais e os índices remotos do projeto `atrio-catolico`. Ele recusa prosseguir se houver índices/overrides inesperados, branch incorreta ou configuração diferente.
3. Compare manualmente no **Console Firebase > Firestore Database > Regras** a regra **atualmente publicada** com `firestore.rules` da PR #42. A regra em produção pode ter sido alterada pelo Termux/Console e não coincidir com a `main` do GitHub. **Não substituir** a regra publicada sem reconciliar quaisquer diferenças. O verificador não comprova essa equivalência.
4. Confirme as execuções mais recentes de `Validar selos (Android e Firestore)`, QA Android, segurança e versão para **o mesmo commit** da PR. O emulador não garante disponibilidade do índice em produção.
5. Só após aprovação separada, planejar duas operações independentes: publicação do **índice** e aguardar que seu status fique pronto; depois publicação das **regras reconciliadas**. Não fazer deploy pela pasta antiga.
6. Verificar no app com contas de teste: acesso permitido a perfil de outro membro, bio privada inacessível, opt-in/retirada e paginação. Monitorar negações e erros. Para voltar atrás, restaurar regras publicadas anteriormente com revisão e autorização; não mexer no backup protegido.

**Estado:** nenhum comando de deploy foi executado. A listagem de índices de 29/10/2026 estava vazia; repetir a consulta antes de qualquer publicação. A verificação de índices é somente do projeto Firebase `atrio-catolico`, banco padrão.

### Orientações de publicação futura (não executar nesta etapa)

Após confirmação da revisão e autorização expressa, usar **parâmetros de projeto explícitos** e operações de escopo limitado. Exemplos para avaliação, não para execução imediata:

```bash
# Exemplo FUTURO: somente indices — cria indice sem substituir regras
firebase deploy --only firestore:indexes --project atrio-catolico
# Exemplo FUTURO: somente regras, depois de reconciliar as vigentes em producao
firebase deploy --only firestore:rules --project atrio-catolico
```

A CLI pode interpretar índices declarados como a configuração desejada; se houver índices remotos não listados no arquivo, primeiro faça a mesclagem, sem exclusões. O arquivo `firebase.json` deve permanecer com as referências revisadas. A publicação das regras pela CLI **sobrescreve** as do Console; por isso a comparação manual é obrigatória.

## Testes
- `tests/security/public-profile.test.mjs`: privacidade, tentativa de usurpação, dados extras, opt-in, retirada, atualização atômica e bloqueio de APK legado após publicação.
- `app/src/androidTest/java/br/com/atriocatolico/PublicMemberProfileUiTest.kt`: autores, respostas e ausência de edição de terceiros.
- Testes existentes de interações, selos e Firestore devem continuar aprovados.

## Limitações respeitadas
- Não houve alteração de backup, de assinatura, de Release oficial, nem implantação Firestore/Cloudflare.
- Os nomes provêm das publicações públicas, ou da projeção opt-in (se existente). Uma pessoa que nunca publicou nem foi citada por vínculo canônico não é localizável por busca global.
- Não se transforma texto livre com `@` em identidade: isso exigiria identificação canônica para evitar perfis errados.
- Testes automatizados e compilação não substituem validação física no Android.
