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
