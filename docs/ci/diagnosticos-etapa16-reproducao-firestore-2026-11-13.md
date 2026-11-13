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
