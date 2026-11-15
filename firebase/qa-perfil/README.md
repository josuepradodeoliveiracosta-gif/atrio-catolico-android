# Perfil QA — regras do piloto Android e verificação no Termux

## Destino e política

O piloto usa o projeto Firebase `atrio-catolico-qa-perfil`, banco `(default)`,
e o aplicativo Android `br.com.atriocatolico.perfilqa`. O fundador confirmou
via Termux que o índice de coleção `posts(uid ASC, createdAt DESC)` está
`READY` nesse banco. [Registro do índice no Perfil QA](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/105#issuecomment-6896840208)

O `firebase.json` da raiz aponta para o `firestore.rules` da raiz. A regra
deste diretório serve ao piloto isolado com contas e dados sintéticos.

| Caminho | Permissões do piloto |
| --- | --- |
| `profiles/{uid}` | Titular com e-mail verificado pode ler e editar `displayName` (2 a 35 caracteres) e `bio` (até 180). Listagem, criação e exclusão são negadas. |
| `public_profiles/{uid}` | Titular com e-mail verificado pode ler a própria projeção e atualizar uma projeção existente na mesma operação atômica da edição privada. Listagem, criação e exclusão são negadas. |
| `posts/{postId}` | Usuário verificado pode ler posts do próprio UID. Consultas exigem filtro pelo próprio UID e limite de até 20, inclusive na busca legada por ID. Escritas são negadas. |
| Demais caminhos | Leituras e escritas são negadas, inclusive selos, fotos, respostas, chats, notificações e `app_config`. |

Quando a projeção pública existe, a edição privada precisa sincronizá-la na
mesma transação ou batch. A regra compara `get()` e `getAfter()` do perfil
privado para exigir uma mudança efetiva em nome ou bio. Uma escrita isolada
de `updatedAt` ou um batch que repete os valores privados é negado.
`updatedAt` deve ser o horário da requisição, e as datas de criação e ingresso
ficam protegidas. O piloto usa contas pré-existentes com e-mail verificado.

## Publicação anterior no Perfil QA

Em 15/11/2026, o fundador confirmou no Termux a publicação específica das
regras da [PR #300, commit `134e86d9`](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/commit/134e86d904261d2aafd0d1cedf9ea2c6944ba180)
no Perfil QA. A leitura após a publicação retornou
`PERFIL_QA_RULES=PUBLICADA_E_CONFIRMADA` e o SHA-256 abaixo, idêntico ao arquivo
da #300 que este candidato incorpora. [Evidência do Termux na Issue #105](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/105#issuecomment-6896892061)

```text
a2cba9b09f7b32bc23c5e863703dacd25fd7e54912275413d21e134be8e9bbee
```

A evidência registra a release lida naquela ocasião. Uma nova publicação
exige autorização expressa do fundador para o destino específico.

## Consulta da release pelo Termux

No clone do candidato, use uma sessão já autenticada no Firebase CLI:

```sh
node scripts/termux-perfil-qa-rules-readonly.mjs
```

O script usa dois GETs para consultar a release e o Ruleset exclusivamente no
Perfil QA. A saída contém os hashes `publishedSha256` e `candidateSha256`,
`publishedDenyAll` e `matchesCandidate`, com os indicadores de destino e de
somente leitura. Tokens e conteúdo integral das regras ficam fora da saída.

| Saída | Como interpretar |
| --- | --- |
| `matchesCandidate=true` e hashes iguais | A release consultada tem o mesmo conteúdo do arquivo local. Confira também se o hash coincide com o da #300 acima. |
| `matchesCandidate=false` | Há divergência de conteúdo. Use os hashes para identificar a release e o arquivo comparados antes de qualquer decisão operacional. |
| Código `0` | A consulta classificou a release como `deny-all`. |
| Código `2` | A consulta leu uma release diferente de `deny-all`. Esse é o retorno esperado para a política do piloto quando `matchesCandidate=true` e os hashes coincidem. |
| Código `1` | A consulta falhou. O estado da release permanece sem confirmação nessa execução. |

## Testes

O CI executa `npm test` em `tests/security` com o Firebase Emulator e o
projeto sintético `demo-atrio-v11`. A suíte inclui 19 contratos das regras do
Perfil QA, 9 de autorização e paginação, 5 do histórico legado e 4 testes do
Termux com respostas simuladas. Para rodar apenas a simulação, use na raiz:

```sh
node --test scripts/termux-perfil-qa-rules-readonly.test.mjs
```
