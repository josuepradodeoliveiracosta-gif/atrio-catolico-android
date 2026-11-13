# Etapa 16 — reprodução controlada das duas falhas históricas Firestore

**13/11/2026 · QA isolado · sem merge nem deploy.**

## Origem e finalidade

A [PR #276](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/276) investigou 13 jobs históricos: 9 interrupções tiveram mecanismo imediato de alta confiança; 4 casos requerem estudo adicional (dois Android e dois Firestore). Este ensaio aborda **somente os dois Firestore**. Os arquivos experimentais foram excluídos das revisões seguintes e não pertencem à `main` atual: eles serão obtidos pelo **commit real do checkout da época**, sem importá-los como regras de produção.

| Caso | Checkout histórico fixado | Condição sob investigação |
| --- | --- | --- |
| `reply_notice` | `43fac1b50ee12fa0ce1b505bf74ebabd4447e001` | O caso positivo `direct_both`, com resposta e dois avisos no mesmo batch, foi negado no laboratório de notificações |
| `chat_general` | `422d00ccbd9ef3c7dce11252be045daf656b8e09` | Uma operação de chat no QA sintético falhou com `PERMISSION_DENIED` e indícios de limite de expressões das Rules |

## Protocolo reprodutível

O workflow `.github/workflows/qa-historic-firestore-repro.yml` funciona **somente** em PR interna com a branch exata `test/qa-historic-firestore-repro-20261113`, com `contents: read`, sem outros escopos ou acesso a segredos. Cada item da matrix recebe um runner descartável, recupera a PR atual apenas para o classificador forense e baixa separadamente uma árvore histórica por SHA integral.

Após conferir SHA e credenciais vazias, utiliza Node/Java adequados à execução original, instala dependências do lockfile histórico com `npm ci --ignore-scripts` e gera somente arquivos temporários de Rules:

- `reply_notice`: executa `node prepare.mjs` e o teste histórico no Firestore Emulator conforme `firebase.json`.
- `chat_general`: executa `node ../../firebase/qa-general/compose-rules.mjs` e o teste histórico no Firestore Emulator conforme `qa-general.firebase.json`.

**Projeto obrigatório:** `demo-atrio-v11`. A execução recusa credenciais Firebase, variáveis de Workers e assinatura do aplicativo. Não configura Firebase real, Cloudflare, dados de pessoas, backups, deploy, re-runs históricos ou merge.

O script `scripts/ci_historic_firestore_repro.py` captura o log original **somente em memória** e grava um JSON pequeno, de conteúdo fixo e sem trechos dos logs, contendo código de saída, SHA do checkout, SHA-256 do log em memória, indicadores binários e uma classificação limitada:

- `historical_positive_batch_denied_symptom_reproduced`: o cenário negativo anterior foi aprovado e o cenário positivo do laboratório de avisos foi interrompido com `PERMISSION_DENIED`.
- `permission_denied_and_rule_limit_symptoms_reproduced`: o QA geral apresentou simultaneamente rejeição e sinal do limite de mil expressões.
- `permission_denied_symptom_reproduced_without_limit`: rejeição observada, sem comprovação do limite.
- `historical_failure_not_reproduced`: teste concluiu sem erro, portanto não se considera a falha antiga presente.
- `different_failure_or_setup_problem` ou `qa_infrastructure_or_test_timeout`: o ensaio não demonstrou o cenário esperado, exigindo inspeção de infraestrutura.

Uma falha histórica reproduzida **não deve ser apresentada como teste bem-sucedido do produto**. O workflow distingue o êxito da **execução forense** do sucesso do código sob teste. Nos casos de falha de preparação/infraestrutura, o job permanece reprovado para revisão.

## Critérios posteriores

1. Registrar os dois resultados JSON, com o `run_id` novo e o SHA exato de checkout.
2. Se o sinal histórico reaparecer, instrumentar somente o predicado necessário de Rules com fixtures independentes para distinguir causa, sintoma e limite de avaliação.
3. Testar controles positivos e negativos e garantir que nenhuma permissão administrativa ou acesso de usuário tenha sido ampliado.
4. Encaminhar cada causa proposta para revisão **independente**. Atestações humanas continuam `0/13` até prova separada.
5. Só propor patch de regras se a falha permanecer relevante para a `main`; os testes históricos não representam automaticamente defeitos atuais.

**Metas de precisão causal de 90% e autocorreção elegível de 99%:** ainda não aferidas. **Nenhuma mudança em produção ou merge está autorizada por este experimento.**

## Etapa 17 — comparação por contrafactuais com controle idêntico

A fase anterior reproduziu `2/2` sintomas históricos em runners isolados, sem afirmar causalidade. Nesta ampliação, a PR passa a executar **duas corridas separadas por cenário** em um novo job `causal-differential` (uma com a árvore histórica original e outra com **uma substituição literal única** nas Rules geradas somente no checkout descartável). Cada corrida inicia uma nova instância do Firestore Emulator, mesmo projeto fictício, mesmas fixtures e assertivas de segurança. O código do teste é copiado para arquivo temporário com marcadores de estágio que **não mudam as assertivas nem as permissões**.

Comparações propostas:

- **Notificações:** substituir apenas `get(...replies/$(request.resource.data.replyToId))` por `getAfter(...replies/$(request.resource.data.replyToId))` na verificação canônica da resposta citada. Ambas leem o mesmo alvo *se já existente e não modificado no batch*, mas possuem semânticas temporais distintas. O teste também mantém os casos negativos de destinatário incorreto e aviso ausente; **nenhuma regra oficial é editada**.
- **Conversas:** materializar um único snapshot de `getAfter(chatQuotaPath(uid)).data` e reutilizá-lo nas quatro comparações do contador, preservando `existsAfter` e os limites `1..5`. O objetivo é diferenciar consultas repetidas de outras origens de erro; se a fonte do contador estiver ausente, o contrafactual pode produzir rejeição antecipada, razão pela qual o resultado é **experimental, nunca patch de produção**.

O runner `scripts/ci_historic_firestore_differential.py` compara o código de saída, último estágio de teste iniciado, sinais binários vistos no log completo, aprovação do caso positivo de notificação e hashes dos candidatos. **Não registra nem publica stdout/stderr, documentos, credenciais ou dados de usuários**. Os campos de precisão, reparo automático e causa comprovada continuam nulos/falsos; resultados inesperados exigem revisão das condições do teste, não são convertidos automaticamente em diagnósticos.

A execução é restrita a PR interna com permissões `contents:read`, referências SHA literais, Node/Java históricos, `demo-atrio-v11`, credenciais Firebase vazias e duas bases locais efêmeras por cenário. O checkout original é conferido por SHA. **A mudança contrafactual ocorre somente em cópia local descartável de Rules.** O novo workflow não executa deploy, Firebase real, Cloudflare, reruns da amostra congelada ou escrita na `main`.

**Critério de interpretação:** se uma variante mudar o resultado, a evidência estabelece apenas que **essa substituição no cenário sintético** mudou o comportamento; ainda será necessária inspeção do predicado exato, preservação das negativas e validação independente antes de atribuir causa raiz. Se a falha persistir, a condição testada isoladamente não foi suficiente para corrigi-la.

## Etapa 18 — leitura de documento compartilhado na regra do convite

**Hipótese verificável:** a operação final reprovada `assertSucceeds(newInvite())`, na linha 402 do teste histórico `qa-general-firestore.test.mjs`, percorre as condições de grupo ativo, administração, elegibilidade etária, bloqueio e `atrioGroupAcceptedContact`. A regra original lê `get(atrioGroupPath(groupId)).data` três vezes no mesmo `allow create`; uma função de Rules experimental pode reutilizar esse documento sem mudar suas condições. Separadamente, `canonicalDirectRecipient()` lê duas vezes o mesmo estado `getAfter(currentPath).data` da resposta citada.

A nova job matrix `cached-predicate` testa dois controles com **apenas uma mudança de leitura equivalente por cenário**:

- `chat_general`: as três referências ao documento do grupo passam a usar um único `let group = get(atrioGroupPath(groupId)).data`, mantendo as verificações de administrador, idade, contato aceito, grupo ativo, prevenção de bloqueio, remetente e dados da solicitação.
- `reply_notice`: a verificação canônica de destinatário direto passa a consultar uma vez `getAfter(currentPath).data` dentro de função auxiliar, mantendo `validId`, `existsAfter`, ambos os campos de destino, consulta da resposta citada e os demais predicados.

Em ambos, o investigador cria **um controle original e uma variante**, cada qual com Firestore Emulator novo, fixtures e verificações positivas/negativas históricas idênticas, sempre `demo-atrio-v11`. As regras da `main` e o histórico do repositório não são alterados; as variantes somente existem dentro do checkout descartável do runner. O instrumento gera JSON sanitizado com código de saída, estágio, SHA da Rules e indicadores de resultado, sem logs brutos.

**Atenção:** mover uma leitura repetida para `let` pode antecipar avaliação em um caso negativo; tal alteração ainda é **somente contrafactual** e não constitui reparo seguro de produção sem validar todos os casos negativos. Se o positivo continuar falhando, a redução isolada não explica a causa. Se passar, será necessária investigação do orçamento de Rules, confirmação semântica e revisão independente. Nenhum sucesso da matriz satisfaz automaticamente as metas 90% e 99%.

## Etapa 19 — cobertura de expressões durante a falha, sem valores privados

O Firebase documenta um endpoint JSON de cobertura das Security Rules, consultável **enquanto o emulador está em execução**: [relatórios do emulador](https://firebase.google.com/docs/rules/emulator-reports). Os dois laboratórios históricos configuram o Firestore Emulator na porta **8089** e o projeto fictício **\`demo-atrio-v11\`**; não usar o endereço de nenhum Firebase externo.

O job \`rule-coverage\` da branch interna usa exclusivamente dois checkouts **SHA literal e auditado** e roda o teste original com um sensor adicionado **somente à cópia efêmera do teste**:

- \`reply_notice\`: consulta \`http://127.0.0.1:8089/emulator/v1/projects/demo-atrio-v11:ruleCoverage\` imediatamente antes e após o caso positivo \`resposta direta com aviso ao autor e destinatario passa\` (\`direct_both\`).
- \`chat_general\`: faz as mesmas duas consultas ao redor de \`await assertSucceeds(newInvite())\`, no estágio da linha 402 do checkout histórico.
- Cada consulta ocorre **dentro do processo Node que executa o teste**: o Firestore Emulator permanece ligado em ambas as consultas. \`try/finally\` preserva a falha esperada e tenta coletar a cobertura mesmo após a rejeição.

A rotina JavaScript consome a resposta JSON **somente em memória** e imprime para seu processo pai exclusivamente contadores numéricos \`t/f/n/o\` por posição de linha/coluna, com limites estritos de profundidade, tamanho e quantidade. O Python captura a saída inteira na memória, seleciona apenas os marcadores gerados pelo sensor e calcula **diferenças de avaliação antes/depois**, ordenando no relatório até 70 posições por contagem de erros/nulos e falsos. **Jamais exportar** HTML, regras textuais, valores de documentos, strings dos avaliadores, capturas de tela, tokens ou logs completos.

Sem cobertura disponível, formato compatível, posição válida ou contadores monotônicos, o resultado deve ser \`unavailable\`/outro código fechado, **nunca uma causa inventada**. Observações registradas são valores agregados do Emulator e **não provam por si mesmas** qual condição é responsável pela negação, tampouco substituem reprodução diferencial e revisão independente.

**Segurança e limites:** projeto exclusivamente \`demo-atrio-v11\`, conexões HTTP só para \`127.0.0.1:8089\`, nenhuma permissão GitHub de escrita, configuração de acesso produtivo recusada, dados QA sintéticos, os arquivos históricos oficiais preservados. A branch/PR continuam rascunho, sem merge, deploy, rerun histórico ou alteração de backups.

**Critério de aceite:** dois jobs \`rule-coverage\` concluídos e seus relatórios JSON sanitizados examinados, com indicação de \`coverage.status\` e contadores da etapa específica. Se o sensor retornar \`unavailable\`, investigar somente a compatibilidade do formato/endereço em nova branch e **não** elevar o progresso causal.

## Etapa 20 — separar falsos esperados de condições responsáveis pela negação

Os primeiros ensaios de cobertura válidos foram registrados no [run 43512082085](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43512082085), com **23/23 checks aprovados no HEAD** \`3283399a03c540229a5413e9c7ff4231bd6ee3e2\`. Os artefatos possuem exclusivamente contagens numéricas por posição, sem strings de Rules, valores de documentos ou logs originais.

- **Avisos de resposta direta:** artefato \`qa-rule-coverage-reply_notice\` ID \`14078672652\`, \`coverage.status=evaluations_observed\`, **358 posições** com diferenças entre antes/depois. A linha **815:24**, com 20 avaliações falsas, corresponde a \`allow update\` do documento de notificação gerado para o laboratório, **não** ao \`allow create\` que o teste positivo tenta executar. A regra candidata foi reconstruída a partir do \`firestore.rules\` histórico (checkout \`43fac1...\`) mais as **35 linhas de helpers** e o predicado de laboratório, adicionando **38 linhas** em relação à fonte. O \`allow create\` de notificações fica aproximadamente nas linhas **784–814**.
- **Convite para grupo:** artefato \`qa-rule-coverage-chat_general\` ID \`14077584542\`, \`coverage.status=evaluations_observed\`, **207 posições** com novas avaliações. A linha **797:14**, com 12 avaliações falsas, corresponde ao caminho de **aceite/atualização** do convite, não ao \`allow create\`. No resultado composto pelas funções históricas de \`compose-rules.mjs\` e \`age16-gate.mjs\` (checkout \`422d00cc...\`), a criação de convite aparece nas linhas **765–788**. As avaliações falsas nas linhas 777 e 786 podem ocorrer de maneira **esperada** como valores interiores às negações \`!(inviteeUid in members)\` e \`!exists(blockedMembers)\`.
- Portanto, **ordenar todas as expressões pelo número de resultados falsos não identifica a causa**. Os relatórios de cobertura são cumulativos, e uma negação esperada ou uma subexpressão negativa pode ser contabilizada como falsa mesmo quando o resultado final do predicado é verdadeiro.

### Novo ensaio: integridade dos dados sintéticos imediatamente antes da falha

O job \`fixture-integrity\` usa o script \`scripts/ci_historic_firestore_fixture.py\` com dois cenários **fixos por SHA**. Insere um sensor **somente na cópia descartável** do teste histórico, antes da operação positiva reprovada, utilizando \`env.withSecurityRulesDisabled()\` **exclusivamente no Firebase Emulator** para confirmar a existência e a coerência dos dados de teste.

- **Notificações:** existência da publicação, correspondência de seu autor, resposta citada \`lucia_seed\`, destinatária da resposta e perfil de remetente sintético.
- **Convite:** existência e status \`accepted\` do chat, grupo \`active\`, administrador esperado, destinatário ausente da lista de membros, configurações chat/grupos ativas, provas de idade e elegibilidade sintéticas de ambos e ausência de bloqueio inverso.
- O relatório salva **somente booleanos de nomes pré-definidos**, código de saída, SHA de checkout e digest do log. Falhas de leitura, formato inesperado, marcadores ausentes e tempo limite são registradas **sem** diagnóstico de causa. Não são gravados nomes, emails, IDs de pessoas reais, dados dos documentos, valores de conteúdo, tokens ou stdout bruto.
- O ensaio **não altera** as regras originais, não ignora as assertivas do teste, não faz deploy e não insere dados no Firebase real. O uso temporário da leitura administrativa é um mecanismo **apenas do SDK de testes local**, presente nos próprios laboratórios históricos.
- Mesmo se todas as fixtures forem consistentes, a rejeição poderá resultar de complexidade de regras, orçamento de operações, semântica da avaliação ou outro fator. É uma **verificação de pré-condições**, não uma causa comprovada ou correção.

**Métricas separadas:** revisão independente \`0/13\`; diagnóstico causal de 90% e reparos elegíveis de 99% **não medidos**. A validação de segurança do novo job e a execução dos dois artefatos são exigidas antes de declarar o marco concluído. A PR continua em rascunho, sem merge, sem alteração da \`main\` ou produção.

### Retificação do primeiro ensaio de integridade das fixtures

A primeira execução \`fixture-integrity\` no [run 43515048548](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43515048548) **não produziu os indicadores esperados**: ambos os jobs concluíram como ensaios, mas o relatório \`reply_notice\` marcou \`invalid_marker\` e \`chat_general\` marcou \`probe_unavailable_or_unexpected_schema\`. Esses códigos **não são** provas de fixtures ausentes nem de causas raiz. Seus testes históricos seguiram encerrando com exit \`1\`.

A instrumentação usava \`row = await env.withSecurityRulesDisabled(callback)\`, pressupondo indevidamente que o método do SDK de testes entregaria o valor retornado pelo callback. Corrigi a aquisição dos booleanos para atribuir \`row\` **dentro do callback**, com sentinela explícita \`probe_unavailable\` e uma regressão offline que rejeita a antiga dependência do retorno. O novo job usa o sensor corrigido em checkout pinado pelo SHA \`f7adb919baf57b5812697a4d96a1ef6e2ad12a09\`.

**Reexecutar a matriz e verificar os dois JSONs sanitizados antes de afirmar qualquer resultado sobre as fixtures.** A falha da primeira instrumentação é registrada para não contaminar a amostra causal, sem excluir resultados anteriores.

### Resultado de pré-condições: notificações verificadas; convite ainda exige localização da leitura

O run [43515781104](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43515781104), no commit \`8e3f113eac45904bf70aad08142cb440b912d779\`, executou os dois jobs \`fixture-integrity\` com o sensor corrigido.

- **Notificações:** artefato \`qa-fixture-integrity-reply_notice\` ID \`14080013348\`; \`status=all_expected_fixtures_present\`, **cinco flags verdadeiras**, \`test_exit_code=1\`. Publicação, autor, resposta citada, destinatária e perfil do remetente sintético foram confirmados; **a rejeição do batch continua**. Logo, a ausência ou divergência desses cinco campos não explica por si só o erro. A causa exata do predicado Firestore ainda está pendente.
- **Convite:** artefato \`qa-fixture-integrity-chat_general\` ID \`14080003452\`; \`status=probe_unavailable_or_unexpected_schema\`, \`booleans={}\`, \`test_exit_code=1\`. **Não inferir** que dados do grupo estejam presentes ou ausentes a partir dessa resposta.

Para o segundo cenário, adicionei uma classificação **estritamente enumerada**, sem mensagens de exceção: as leituras dos nove documentos de QA passaram a ser **sequenciais** com estágio fixo (\`read_contact\`, \`read_group\`, \`read_chat_policy\`, \`read_group_policy\`, \`read_inviter_age\`, \`read_invitee_age\`, \`read_inviter_group\`, \`read_invitee_group\`, \`read_inverse_block\`, \`evaluate_flags\`). Em caso de falha, o relatório revela apenas o estágio e uma categoria de erro de lista fechada (\`FirebaseError\`, \`TypeError\`, \`RangeError\`, \`Error\`, \`other\`) — jamais caminho de recurso não esperado, valores da resposta, pilha, tokens ou log bruto. Uma regressão offline valida as enumerações e rejeita valores arbitrários.

**Apenas a branch de QA foi editada.** O novo harness foi pinado por SHA \`862098908a72bc8209b78b4909183b8dfaaecd44\`; é obrigatório examinar nova execução dos dois jobs antes de alterar os rótulos causais. Atestações humanas permanecem 0/13 e metas 90%/99% não aferidas.

## Etapa 22 — corrigir escopo lexical do sensor de convites

No run [43518120969](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43518120969), **10/10 jobs forenses concluíram a execução**, mas os testes positivos históricos ainda terminaram com `test_exit_code=1`. Os JSONs sanitizados de integridade de fixtures mostraram:

- `reply_notice`, artefato `14081486940`: `all_expected_fixtures_present`, **5/5 booleanos verdadeiros**, operação original rejeitada (`test_exit_code=1`). Isso valida apenas esses cinco pré-requisitos sintéticos; a causa da rejeição da notificação não foi isolada.
- `chat_general`, artefato `14081601943`: `probe_unavailable`, `stage=read_contact_complete`, `failure_category=ReferenceError`, `booleans={}`, `test_exit_code=1`. **Nenhuma conclusão sobre integridade das fixtures pode ser extraída** desse resultado.

Ao comparar o sensor com o arquivo histórico `tests/security/qa-general-firestore.test.mjs` no SHA `422d00cc...`, identificou-se defeito **do sensor**, não das Rules: `inviteGroup` foi declarado como `const` **dentro** do bloco `try`, enquanto `qaSyntheticFixtureProbe()` foi declarado fora dele. A primeira leitura de `room` terminou; a expressão seguinte buscou `inviteGroup` fora do escopo, gerando `ReferenceError` antes de iniciar a leitura do grupo.

Corrigido **somente no harness de QA**: invocação `qaSyntheticFixtureProbe(inviteGroup)` no ponto original do teste, parâmetro lexical explícito no sensor e preflight que rejeita fonte histórica sem declaração única anterior ao caso positivo. Testes offline verificam a injeção no local correto, preservação do caso negativo e ausência de chamada sem parâmetro. O workflow de `fixture-integrity` faz checkout do sensor por SHA fixado `7439710501e8d3af3e22b1678b73dbe644ffc8b6` (sem credenciais, apenas `demo-atrio-v11`).

**Próximo critério de aceite:** examinar 2/2 artefatos do novo HEAD e conferir todos os checks. Se o sensor de convite retornar flags, analisá-las antes de investigar o `allow create`; se retornar outra categoria, revisar somente o novo estágio. Em qualquer caso, **não** inferir causa da negação original, taxa de 90% ou reparo automático de 99% sem revisão causal independente. PR continua draft, sem merge, deploy ou alteração produtiva.
## Etapa 23 — experimento de isolamento de uma guarda (proposta ainda NÃO validada)

A etapa 22 verificou **13/13 condições de fixture do convite** e **5/5 condições da notificação**, porém ambos os testes positivos históricos continuam com `test_exit_code=1`. Assim, não basta inspecionar presença de documentos; a próxima comparação deve testar a contribuição de UMA condição para a rejeição, usando o MESMO teste histórico e o MESMO banco sintético inicial em duas instâncias isoladas do Firestore Emulator.

O job `guard-isolation`, acrescentado ao workflow forense já existente, executa controles históricos e uma variante deliberadamente **menos restritiva, apenas na árvore descartável do runner**:
- `chat_general`: a condição final `atrioGroupAcceptedContact(...)` do **`allow create` de convites** é substituída temporariamente por `true`, sem modificar as outras guardas, a declaração de idade ou as assertivas históricas.
- `reply_notice`: é omitida temporariamente apenas uma leitura `exists(.../replies/$(targetId))` dentro de `canonicalDirectRecipient()`; a verificação `get(...).data.uid == recipientUid` permanece e o lote original continua obrigatório.

**Aviso de segurança:** esses desvios intencionais de autorização **NÃO são correções, não preservam necessariamente todas as propriedades de segurança e jamais são elegíveis a deploy ou merge nas Rules oficiais**. O objetivo é observar se a remoção experimental de uma guarda altera o estágio de falha. Os testes negativos originais são mantidos, mas não abrangem todas as propriedades da guarda retirada. Mesmo se a variante passar, isso NÃO justifica retirar a guarda no produto: primeiro será necessário encontrar uma mudança semanticamente segura e exigir revisão independente.

A execução usa `demo-atrio-v11`, dois emuladores descartáveis, fontes históricas fixas por SHA, permissões GitHub `contents:read`, credenciais produtivas vazias e apenas JSON sanitizado (código, estágio, hash, sem documento, Rules, log ou segredo). Os checkouts originais são restaurados após o ensaio. O workflow de origem continua único e sem deploy.

**Critérios de aceite:** dois jobs `guard-isolation` realmente concluídos, classificação dos resultados controle×variante por cenário, todos os checks obrigatórios verdes no HEAD exato, nenhuma alteração na `main`/produção/backups; se houver resultado inconclusivo, registrar como tal. Causas revistas independentemente: 0/13; métricas 90% e 99% não aferidas.

## Etapa 24 — observação local da operação positiva (13/11/2026)

**Motivação:** no experimento de isolamento da etapa 23, o `chat_general` avançou do positivo de criação do convite (linha histórica 402) até o reconvite (linha 433) quando a guarda `atrioGroupAcceptedContact` foi omitida **somente no Emulator**. Os logs globais indicavam um possível limite de 1000 expressões em algum ponto da suíte; isso **não autoriza** atribuir tal limite especificamente à operação de criação. A guarda é essencial e permanece obrigatória nas Rules oficiais.

**Novo instrumento:** em vez de acrescentar outro workflow/job, o existente `rule-coverage` recebe um marcador de resultado da **asserção positiva específica**:
- `reply_notice`: encerra a observação exatamente no `assertSucceeds(b.commit())` do caso `direct_both`, preservando a leitura posterior da notificação e os testes negativos;
- `chat_general`: observa somente `assertSucceeds(newInvite())` após a restauração da idade sintética do destinatário.

Uma cópia descartável dos testes históricos passa a envolver somente a asserção positiva num `try/catch`, que **repropaga a exceção original**; nenhuma asserção é suprimida. O marcador `QA_TARGET_RESULT` informa estritamente `accepted/rejected`, categoria de erro enumerada e presença/ausência do texto **“maximum of 1000 expressions” na exceção da própria operação**. Mensagens, códigos arbitrários, stacks, paths inesperados, documentos e logs brutos jamais são exportados. O marcador ausente ou duplicado produz código inconclusivo; regex de logs globais não substitui o marcador.

O relatório de cobertura por posição continua independente e cumulativo; avaliações falsas em `allow update` durante `create` não são prova causal. A instrumentação local não é correção das Rules, não altera a permissão de acesso e não supre uma revisão independente.

**Critério de aceite:** verificar o novo run da PR #277 nos dois membros da matrix `rule-coverage`, examinar `target_write` de cada JSON sanitizado e os demais gates do HEAD; registrar `not_observed` se houver interrupção antes do alvo. Todos os checkouts de laboratório permanecem fixados por SHA e executam somente no `demo-atrio-v11` em `127.0.0.1:8089`, sem tokens, deploy, produção ou backups.

**Estado de comprovação:** 0/13 causas independentemente atestadas; as metas de 90% de precisão causal e 99% de automação continuam não medidas. O número de etapas é um organizador do trabalho, não percentual de precisão do diagnóstico.

## Etapa 25 — observar o valor da guarda de contato SEM removê-la

Os ensaios anteriores provaram que: (a) o cenário sintético de convite possui 13/13 pré-condições verificadas; (b) a criação real do convite segue com `permission_denied`; (c) remover TEMPORARIAMENTE `atrioGroupAcceptedContact` **apenas no Emulator** faz o teste avançar da linha histórica 402 até o reconvite da linha 433; (d) a mensagem da exceção da criação não menciona explicitamente o limite de 1.000 expressões. Nenhuma dessas constatações, isoladamente, atesta a causa raiz.

Para distinguir valor lógico e erro de avaliação, o novo job `contact-guard-debug` executa **o mesmo teste histórico** no projeto `demo-atrio-v11` em duas instâncias isoladas: baseline com a candidata QA original e variante com `debug(atrioGroupAcceptedContact(...))` **somente no `allow create` do convite**. Conforme a documentação oficial [Firebase `rules.debug`](https://firebase.google.com/docs/reference/rules/rules.debug), a função `debug(expr)` retorna `expr` e registra o resultado apenas no log local do Emulator. **Todos os predicados de autorização e os testes positivos/negativos permanecem intactos**. A variante não deve ser implantada, nem confundida com um reparo.

O script `scripts/ci_historic_firestore_contact_debug.py` verifica fonte e SHA históricos, recusa `debug()` preexistente e fontes inesperadas, impede qualquer identidade produtiva, só observa resultados de `bool_value` local com enumeração fechada e destrói o `firestore-debug.log` antes da conclusão. Nunca publica logs, mensagens de erro, documentos, snippets de Rules, tokens, paths privados ou valores de usuários. Marcador ausente, divergente ou ambíguo resulta em estado inconclusivo. Os testes offline no módulo `test_ci_historic_firestore_contact_debug.py` garantem que o `debug()` envolve **a mesma condição** e não substitui autorização por `true`.

**Aceite desta etapa:** conferir novo HEAD, preflight de SHA, regressões offline, artefato JSON sanitizado com `baseline` e `debug_preserving_guard`, e todos os gates obrigatórios. Um `bool_value` verdadeiro ou falso observado no log é **evidência de avaliação local**, não causa causalmente adjudicada: debugar pode influenciar orçamento de expressões, e logs agregados podem conter avaliações múltiplas. Não usar resultado inconclusivo como evidência de ausência da chamada.

A PR continua draft, sem merge, deploy, atualização de `main`, produção ou backups. Atestações causais independentes: 0/13; metas 90% e 99% continuam não mensuradas.

### Errata da primeira leitura com `debug()` e sonda com sentinela

O primeiro run da etapa 25, [43524340457](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43524340457), concluiu **13/13 jobs do workflow forense como `success` de execução**. O artefato sanitizado `qa-contact-guard-debug`, ID `14083364184`, mostrou baseline e variante preservando a guarda com `exit_code=1`, `last_started_stage=chat_line_402` e `expression_limit_seen_somewhere=true`. No log local, a sonda `debug(atrioGroupAcceptedContact(...))` não produziu nenhum `bool_value` reconhecível: `contact_debug.status=no_boolean_debug_observed`, contagens `0/0`. **É inconclusivo**: não prova guarda `false`, tampouco que a função não foi alcançada.

Para diferenciar log incompatível de interrupção anterior à função, a segunda versão coloca `debug('QA_ATRIO_CONTACT_CREATE_CANARY') == 'QA_ATRIO_CONTACT_CREATE_CANARY'` **no início do mesmo `allow create` experimental** e preserva o `debug()` ao redor da condição final. É uma identidade verdadeira em contexto do Emulator, sem liberalizar o acesso; o avaliador aceita apenas sentinela de tipo `string_value` e booleanos `bool_value` com estados enumerados. Se a sentinela aparecer sem booleano, isso significa somente que o resultado da guarda não foi observado naquela execução, sem inferir a razão. Os logs privados ou de erro não são exportados e são destruídos após o ensaio.

**Aceite da revisão:** conferir artefato novo, ambos os resultados baseline/sonda e todos os checks do HEAD atualizado, antes de qualquer novo rótulo. O diagnóstico não pode contar experimento inconclusivo como causa comprovada.

### Resultado da sentinela e instrumentação interna em três fases

O run da segunda sonda [43525025182](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43525025182), artefato sanitizado **`qa-contact-guard-debug` 14083843893**, encontrou: baseline e variante `exit_code=1`, `chat_line_402`, `permission_denied_seen_somewhere=true`, `expression_limit_seen_somewhere=true`. **A sentinela de entrada da regra apareceu** (`canary_marker_seen=true`), enquanto o retorno `bool_value` da função de contato foi **não observado** (`false_count=0`, `true_count=0`, `bool_keyword_seen=false`). A conclusão limitada é que o log de debug funciona na entrada da regra; não se sabe se a função não foi alcançada ou se alguma etapa dela foi interrompida. **Não rotular `false` ou causa raiz.**

A terceira sonda mantém a sentinela e envolve, sem mudar seu valor, as **três subexpressões originais** de `atrioGroupAcceptedContact` com `debug()`: `validId(contactChatId)`, ordem/identidade canônica dos dois UIDs e `get(chats/... ).data.status == 'accepted'`. Marcadores `QA_ATRIO_CONTACT_ID/PAIR/STATUS` aparecem somente em um `firestore-debug.log` local e são convertidos em indicadores fechados por fase (`true`, `false`, `mixed`, `not_observed`); o arquivo bruto é destruído, não arquivado. A função continua exigindo exatamente as três condições originais, e testes offline rejeitam remoção ou troca de guardas. O resultado pode variar com o custo de `debug()` e não serve, isoladamente, como comprovação independente de causalidade.

Critério: verificar run novo do HEAD e a ordem/contagem dos marcadores, 13 jobs de QA, todos os gates da PR e ausência de alterações de produção. Rejeição antes da primeira subexpressão continua possível. Metas 90%/99% e 0/13 atestações permanecem inalteradas.

## Etapa 26 — separar existência do documento e leitura do status

**Ponto de partida validado:** no HEAD `b2baa1ead7b12270882da3251cb6213123adb069`, 7/7 workflows e 13/13 jobs do laboratório terminaram com `success` de execução (não significa que as operações históricas passaram). O artefato `14085086265` mostrou `valid_id=true` e `canonical_pair=true` no caminho experimental de contato aceito, seguido de marcador `chat_accepted` sem um retorno booleano. Causas independentes: `0/13`.

**Experimento novo somente no Emulator:** dentro de `atrioGroupAcceptedContact`, a sonda acrescenta `debug(exists(/databases/$(database)/documents/chats/$(contactChatId)))` como uma condição `&&` antes da avaliação já existente `debug(get(...).data.status == 'accepted')`. Um marcador enumerado `QA_ATRIO_CONTACT_EXISTS` separa a **existência da conversa** do **resultado da leitura do status**. O predicado de autorização não foi removido, substituído por verdadeiro, nem afrouxado; a sonda pode impor uma exigência adicional e **alterar custo, avaliação em curto-circuito e limite**. Portanto, mesmo se funcionar, **não constitui correção pronta nem equivalência formal com as Rules oficiais**. O baseline usa as Rules anteriores sem alteração. Todas as assertivas históricas positivas e negativas permanecem presentes.

O log do Emulator é processado localmente em contagens e rótulos fechados (`true`, `false`, `mixed`, `not_observed`) para `valid_id`, `canonical_pair`, `chat_exists` e `chat_accepted`. O conteúdo do documento, paths não previstos, logs brutos, valores de usuários e mensagens arbitrárias nunca são publicados. Se a análise não enxergar `chat_exists` ou `chat_accepted`, registra-se **inconclusivo**. A interpretação exige considerar múltiplas operações presentes na suíte e o efeito das chamadas `debug()`.

**Aceite para esta etapa:** validar os testes offline e a nova execução `contact-guard-debug` no checkout histórico por SHA, comparar controle/variante, conferir os 13 jobs forenses e todos os workflows da PR no HEAD exato. O objetivo é escolher o próximo experimento de prova mínima; `0/13` revisões independentes e metas 90%/99% continuam não aferidas. Sem merge, deploy, alterações de backups, production Rules ou dados reais.
