# Análise do TXT — Perfil 2.0

O projeto de UX é aproveitável, mas o código do TXT **não está pronto para aplicação**. Ele mistura funções existentes com novas propostas, perde contratos da base atual e introduz problemas de privacidade. Esta entrega corrige a especificação; **não implementa as dez funções no aplicativo**.

Documento revisado: [Perfil 2.0 — proposta corrigida](../perfil-2-0-proposta-revisada-20261117.txt).

## Identidade, escopo e progresso

- Agente: Codex; papel: análise e revisão documental; sem atribuição presumida a um dos sete chats.
- Repositório: `josuepradodeoliveiracosta-gif/atrio-catolico-android`.
- Base consultada: [`main@ebbed2edcdefa77fbda785ca6324aafa6d376c11`](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/commit/ebbed2edcdefa77fbda785ca6324aafa6d376c11), em 17/11/2026. Todas as referências de código abaixo estão fixadas nesse SHA.
- O TXT usava `6c7afcbe`; seu SHA-256 é `058eb32ed64d1a91e371160a7d7d2df69982cf2db955c90b57bfa5347cc30ea7`.
- Lidos [AGENTS.md](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/AGENTS.md), documentação de Perfil e QA, código e contratos relacionados, PRs abertas e registros da [Issue #105](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/105). Não foram alteradas branches de outros responsáveis.
- Critérios desta tarefa: identificar a base; comparar as dez ideias e seus riscos; corrigir a especificação com evidências; revisar e disponibilizar a entrega. Marcos de mesmo peso. O status final e a branch/commit de entrega ficam na PR desta revisão.
- Progresso da **análise documental**: `[##########] 100% (4/4 marcos)`. Base identificada, comparação e provas concluídas, especificação corrigida e entrega disponibilizada para revisão. Esse percentual não mede implementação, homologação ou liberação do Perfil 2.0.

O Gradle dessa base declara `defaultConfig` **0.20.4 / 39**. Isso não identifica a versão instalada nem comprova release ou assinatura. As Rules aqui comparadas são arquivos versionados: sua implantação remota atual não foi consultada.

## Comparação das dez melhorias

| Ideia do TXT | Estado observado | Correção da proposta |
| --- | --- | --- |
| Identidade católica opcional | Paróquia privada já existe; estado civil, santo e sua projeção pública são novos | Manter fonte canônica da paróquia, consentimento e transação compatível; aprovar campos novos antes de gravar |
| Ver como me veem | Tela pública existente; atalho/banner novos | Reusar a tela, distinguir projeção publicada de rascunho e preservar callbacks |
| Membro desde | Perfil público já mostra data de ingresso | Reusar data real e mudar apresentação; nunca fabricar ou liberar alteração da data |
| Selos interativos e linha do tempo | Selos clicáveis e status de pedido já existem | Ampliar última decisão/nota; não duplicar componente nem chamar um documento de histórico completo |
| Diagnóstico Android | Permissão e diagnóstico já fazem parte de PushSettings | Integrar inspeção de canais e retorno dos ajustes; não inferir bloqueio por falta de isenção de bateria |
| Interesses de formação | Preferências, consentimento e remoção já existem | Preservar campos/enum atuais; seis temas novos dependem de contrato próprio |
| Contato em Conversas | Contrato `chatSettings/privacy.requests` existente | Reusar `all`/`none`, gates e demais preferências; descartar `profiles.allowDirectMessages` |
| Membros bloqueados | Contrato e bloqueio/desbloqueio individuais existentes | Acrescentar lista central com paginação, falha e confirmação |
| Senha, regras e privacidade | Auth e regras comunitárias disponíveis | Atalhos com ambiente/provedor corretos; política de privacidade é documento distinto |
| Exportação de dados | Implementação nova proposta, com escopo parcial | Rotular recorte, tratar leituras incompletas e armazenamento/compartilhamento seguros |

## Achados que impedem aplicar o TXT como está

As prioridades abaixo se referem à adoção da proposta. Não são alegações de que essas falhas estejam implantadas em produção.

### A1 — Regressão de segurança nas datas e no esquema

**Alta.** A seção 7 reúne criação e edição em uma condição ampla `allow create, update`, sem imutabilidade de `createdAt`, sem exigir todos os campos e sem vincular `joinedAt` à data privada. No Emulator, o fragmento aceitou alteração de cadastro, ingresso divergente e projeção sem ingresso. As Rules atuais negaram a alteração de `createdAt`.

Correção documental: manter o ciclo de criação, allowlists por operação, campos obrigatórios e timestamps; exigir `joinedAt == profiles.createdAt`. Não copiar o fragmento para a raiz ou para o piloto.

Evidências: [Rules atuais de perfil e projeção](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/firestore.rules#L402), [Rules restritas do Perfil QA](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/firebase/qa-perfil/firestore.rules#L30) e testes R6–R9 abaixo.

### A2 — Exclusão de dados além dos interesses

**Alta.** `CatholicFormationInterestsCard` chama `.delete()` em `users/{uid}/private/preferences`. Esse documento também guarda cidade, participação e paróquia. O ensaio confirmou sua exclusão integral. O texto “Apagar interesses”/“Apagar” não descreve esse efeito.

Correção documental: limpar somente interesses preservando o restante, ou usar o fluxo de revogação integral existente com rótulo e confirmação correspondentes. Ao introduzir projeções novas, também revogar as cópias públicas dependentes.

Evidências: [contrato privado atual](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/firestore.rules#L589), [personalização existente](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/main/java/br/com/atriocatolico/RegistrationV2.kt#L101), teste R5.

### A3 — Consentimento retirado e preferências incompatíveis

**Alta.** A substituição integral de `ProfileScreen.kt` remove `RegistrationOptionalPreferences`. A nova lista troca o enum de interesses, usa `consentVersion = 2026-11-v1` em vez de `cadastro-v2-2026-11` e não apresenta o controle de consentimento existente. Na criação faltam campos obrigatórios; no merge enum/versão continuam incompatíveis. A gravação foi negada nos dois casos no Emulator. O editor ainda duplicaria a paróquia sem sincronizar a fonte de cadastro.

Correção documental: preservar o componente e seus dados; separar autorização para guardar de autorização para publicar; manter paróquia canônica. Temas detalhados ficam para contrato/migração próprios. Leitura assíncrona precisa terminar antes de iniciar um rascunho, sem substituir edição em curso.

Evidências: [chamada atual no Perfil](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/main/java/br/com/atriocatolico/ProfileScreen.kt#L183), [enum e consentimento](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/main/java/br/com/atriocatolico/RegistrationV2.kt#L80), testes R3–R4.

### A4 — Permissão de Conversas sem efeito no serviço

**Alta.** O TXT grava `profiles.allowDirectMessages`; o fluxo existente consulta `users/{uid}/chatSettings/privacy.requests`. A chave nova seria negada pelas Rules atuais e não controlaria solicitações mesmo se fosse admitida. Um controle no Perfil não substitui os gates de elegibilidade e de habilitação de Conversas.

Correção documental: reutilizar `requests = all/none`, mantendo `readReceipts` e `showPushPreview` quando já existirem. Explicar que a chave controla novos pedidos e não ativa o serviço nem dispensa aceite.

Evidências: [Rules do contrato de Conversas](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/firebase/atrio-conversas-v1.rules.fragment#L16), [preferência na tela](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/main/java/br/com/atriocatolico/AtrioConversations.kt#L327), [política ainda acompanhada na #200](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/200), teste R2.

### A5 — Incompatibilidades estáticas de compilação

**Bloqueador de integração.** O TXT retira os parâmetros `onConversations` e `onConverse` das telas. `OnlineAtrioApp.kt` os passa nominalmente nos dois pontos de chamada atuais. O complemento de selos também usa `BadgeDescription.id/label/description/accent`, enquanto o tipo real é `private` e tem `kind/name/details/tint`. Expô-lo numa função `internal` é incompatível com essa visibilidade. O adaptador de `ProfileEditorDialog` do TXT descarta os campos novos no callback legado.

Correção documental: evolução incremental das assinaturas atuais, sem substituir arquivos inteiros; reusar `MemberBadgeRow` e compatibilizar editor, testes e consumidores. A conclusão aqui é de revisão estática: não foi executado build do Kotlin do TXT.

Evidências: [onConverse consumido](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt#L1374), [onConversations consumido](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt#L1528), [modelo e componente de selos](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/main/java/br/com/atriocatolico/BadgeUi.kt#L38).

### A6 — Plano de QA incompatível com a variante atual

**Bloqueador de validação.** `perfilQa` é buildType; `connectedPerfilQaDebugAndroidTest` não corresponde à configuração. O gate aceita somente `assemblePerfilQa`, o launcher é `PerfilQaActivity`, as Rules negam preferências/selos/conversas e o Manifest remove push, OTA e FileProvider. Editar `OnlineProfileScreen` não faz o piloto passar a abrir essa tela.

Correção documental: manter o piloto mínimo. Para o fluxo comunitário ampliado, reaproveitar QA Geral local com Auth/Firestore Emulator e as novas Rules candidatas devidamente compostas. Não abrir permissões do piloto nem alegar teste dessas funções nele.

Evidências: [gate de build](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/build.gradle.kts#L133), [testBuildType](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/build.gradle.kts#L379), [Manifest do piloto](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/perfilQa/AndroidManifest.xml), [workflow de instrumentação existente](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/.github/workflows/android-bots-ui.yml).

### A7 — Exportação com provider incorreto e escopo exagerado

**Alta.** O TXT usa `${context.packageName}.fileprovider`; o Manifest declara `${applicationId}.ota.fileprovider`. Isso impede obter a URI com a autoridade indicada. Além disso, coloca dados sensíveis no diretório de OTA, faz três leituras apesar da promessa de não fazer leituras extras e converte falhas de duas leituras em ausência de dados. O recorte não inclui todos os dados da conta.

Correção documental: “Exportar dados do perfil”, conteúdo/limites explícitos, falhas e cache indicados, identidade da sessão conferida, gravação em destino escolhido via Storage Access Framework ou compartilhamento temporário em diretório/provider próprios. Não alterar o provider de OTA só para contornar o erro.

Evidências: [autoridade e provider atuais](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/main/AndroidManifest.xml#L15), [pasta restrita de OTA](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/main/res/xml/ota_file_paths.xml).

### A8 — Componentes novos declarados sem ligação e diagnóstico incompleto

**Média.** O TXT declara `InteractiveMemberBadgeRow` e `AndroidNotificationHealthBanner`, mas os fluxos apresentados continuam usando a linha de selos antiga e não chamam o banner. `areNotificationsEnabled()` não inspeciona cada canal. `remember` não refaz o diagnóstico ao retornar dos ajustes com as mesmas flags. Não ter isenção de otimização não prova restrição real. O cartão de pedido mostra só o estado atual e não trata todos os estados existentes.

Correção documental: ampliar componentes atuais, ligar a UI de fato, observar retorno ao primeiro plano e distinguir estados. Manter `dismissed`/`revoked` e a nota pertinente sem abrir `badge_events` indevidamente.

Evidências: [selos já interativos](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/main/java/br/com/atriocatolico/BadgeUi.kt#L73), [estados de solicitação](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/main/java/br/com/atriocatolico/BadgeUi.kt#L169), [PushSettings](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/app/src/main/java/br/com/atriocatolico/PushSettings.kt#L36).

### A9 — Estado assíncrono, prévia e acessibilidade

**Média.** O TXT inicializa campos antes de leituras assíncronas, ignora certos erros/remoções de documentos e promete “assim que outros veem” sem distinguir falta de projeção ou cache. A lista de bloqueados carrega todos os nomes, sem paginação e sem informar falha no desbloqueio. Uma linha obrigatória para tudo e chip mínimo de 36dp conflitam com a meta de fonte 200% e alvo de 48dp.

Correção documental: estados explícitos de carga/ausência/erro/cache; rascunho inicializado após carga e preservado; callbacks invalidados ao trocar conta/sair; resumo de publicação real; paginação de bloqueados e texto que quebra linha. Não anunciar que retirar a apresentação esconde foto, selos ou posts.

### A10 — Testes declarados, mas sem execução integrada

**Bloqueador de comprovação.** A seção 8 só exporta `runProfileCatholicIdentityTests`. Executar o arquivo com `node` não chama a função. Não há inicialização/limpeza de ambiente nem ligação ao comando atual, e seis cenários não cobrem revogação, datas, consentimento, cache, perda de dados e compatibilidade antiga.

Correção documental: testes executáveis ligados à suíte atual, com fixtures isoladas e regressões por SHA. Não chamar as dez funções de “implementadas”.

Evidência: [comando atual de testes](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/blob/ebbed2edcdefa77fbda785ca6324aafa6d376c11/tests/security/package.json).

## Verificações executadas nesta revisão

Ambiente local: **Node 22.23.5**, **Java 21.0.13**, dependências instaladas com o `package-lock.json` da base. Firestore Emulator em **127.0.0.1:8089**, projeto sintético **demo-atrio-v11**. A instalação de dependências não mudou o lockfile nem o projeto remoto.

1. A suíte existente `public-profile.test.mjs` passou: **30/30** verificações. Isso exercitou as Rules versionadas da base, não uma Rule corrigida nova nem o Firebase remoto.
2. O ensaio direcionado passou: **9/9** verificações, listadas abaixo.

| ID | Verificação | Resultado |
| --- | --- | --- |
| R1 | Escrever identidade nova/updatedAt privado com Rules atuais | Negado |
| R2 | Escrever allowDirectMessages em profiles com Rules atuais | Negado |
| R3 | Criar preferências usando o payload do TXT | Negado |
| R4 | Mesclar esse payload a preferências válidas existentes | Negado |
| R5 | Executar delete como o botão de interesses do TXT | Apagou documento com cidade, participação e paróquia fictícias |
| R6 | Alterar createdAt com Rules atuais | Negado |
| R7 | Alterar createdAt usando fragmento do TXT em harness local | Aceito indevidamente |
| R8 | Publicar joinedAt divergente usando fragmento do TXT | Aceito indevidamente |
| R9 | Publicar sem joinedAt usando fragmento do TXT | Aceito indevidamente |

R7–R9 são **reproduções de falhas**, não aprovação da proposta. O harness usou literalmente as condições da seção 7, adicionando apenas wrapper de Rules e `me(uid)` para o titular autenticado. Isso isola o defeito do fragmento e não comprova uma composição com todos os contratos existentes. As Rules atuais e as do TXT foram carregadas em rodadas separadas; não foram mescladas.

As fontes do ensaio e a saída resumida ficam em [evidencias/perfil-txt-20261117](evidencias/perfil-txt-20261117). Para reproduzir, use uma cópia descartável do repositório no SHA da base, sem credenciais/configuração de serviços reais, e copie os dois arquivos de evidência para `tests/security`:

```sh
cp docs/qa/evidencias/perfil-txt-20261117/reproduzir.mjs tests/security/proposal-review.compat.test.mjs
cp docs/qa/evidencias/perfil-txt-20261117/rules-originais-do-txt.txt tests/security/proposal-review.original.rules
```

Os arquivos de evidência pertencem à PR de documentação. Se o checkout estiver exatamente na base anterior à PR, traga somente esses arquivos antes de executar. O fragmento arquivado é intencionalmente a proposta original defeituosa e serve exclusivamente ao Emulator; não deve ser implantado.

Comando executado na cópia local, em `tests/security`, após `npm ci --ignore-scripts --no-audit --no-fund` e o preparo acima:

```sh
npx --yes --package=node@22 --call 'node prepare.mjs && firebase emulators:exec --only firestore --project demo-atrio-v11 "node public-profile.test.mjs && node proposal-review.compat.test.mjs"'
```

`proposal-review.compat.test.mjs` e o wrapper de Rules são evidências desta análise, fora do runner oficial. As condições do wrapper foram extraídas da seção 7 do TXT cujo hash está registrado acima. A versão corrigida define critérios para a implementação futura; nenhuma Rule nova corrigida foi aplicada ou certificada.

**Não executados nesta revisão:** compilação Android dos snippets, testes Compose, APK da proposta, instalação/QA físico, teste de entrega de push, consulta de dados reais ou publicação de infraestrutura. Não houve merge, deploy, migração, assinatura ou acesso a backups.

## Estado do CI observado e continuidade

A consulta do CI da base mostrou, entre outros, [build concluído com sucesso](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/44128684463) e [CodeQL concluído com sucesso](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/44128684459). Também havia [um relatório consolidado com failure](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/44129794034). Esse relatório já existia antes desta entrega, não foi investigado aqui e não é atribuído ao TXT. Portanto, não se declara “todo o CI verde”. Esses runs não validam a implementação das dez ideias.

O recorte desta PR é documentação e evidências isoladas de revisão. Não é necessário alterar o Gradle, gerar versão ou disparar builds manuais para revisar o texto. Os checks automáticos obrigatórios da PR continuam valendo e são acompanhados separadamente.

Próxima ação concreta: revisar a especificação corrigida e atribuir seu primeiro recorte na Issue #105. A ordem proposta é contrato/consentimento/Rules locais, UI incremental, validação de cada recorte e aparelho em ambiente autorizado. O TXT revisado contém critérios de aceitação e prompts curtos por especialidade. Nenhum outro chat recebeu automaticamente uma atribuição.

**Parecer:** proposta documental corrigida para revisão; implementação do Perfil ampliado ainda pendente. Sem autorização de merge, Firebase remoto, produção, assinatura, publicação ou serviços pagos.
