# Etapa 5 — Avaliação independente e critérios de aceite

Data: 12/11/2026 — **QA apenas**, PR #258 em draft. Avaliação exploratória de casos históricos não utilizados como fixtures de treinamento do classificador.

## Linha de base no conjunto separado

Foram examinados **9 jobs com falha e 3 jobs aprovados**. A verificação reexecutou a lógica das regras sobre os logs históricos na conexão GitHub, sem guardar, publicar ou inserir os logs brutos no repositório. O classificador de produção **não realiza ingestão automática**. Esta amostra é dirigida e pequena, portanto **não autoriza estimar precisão geral**.

| Job histórico | Estado confirmado | Sinal obtido | Evidência |
| --- | --- | --- | --- |
| QA Cloudflare — configuração de bootstrap | Falha | `generic_test_assertion` | [run 42917265593](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42917265593) |
| QA marco 3 — evidências | Falha | `generic_test_assertion` | [run 42914673911](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42914673911) |
| Firestore — preflight NO-GO | Falha | `generic_test_assertion` | [run 42908852402](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42908852402) |
| Chat 18+ — concorrência local | Falha | Inconclusivo | [run 42901654186](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42901654186) |
| Revisão de dependências | Falha | Inconclusivo | [run 42895549772](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42895549772) |
| Relatório de CI | Falha | Inconclusivo | [run 42894991445](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42894991445) |
| Firestore QA geral | Falha | `generic_test_assertion` | [run 42737465188](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42737465188) |
| OTA QA — emulador | Falha | `android_adb_offline` | [run 42626966123](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42626966123) |
| Privacidade — emulador | Falha | `generic_test_assertion` | [run 41256125137](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41256125137) |
| Guardião — observação somente leitura | Sucesso | Não aplicável; nenhum sinal | [run 43244638224](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43244638224) |
| Relatório de CI | Sucesso | Não aplicável; nenhum sinal | [run 43245060350](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43245060350) |
| Chat QA — autodeclaração 18+ | Sucesso | Não aplicável; nenhum sinal | [run 43234961772](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43234961772) |

**Resumo descritivo:** entre nove falhas: **1** teve sinal específico, **5** somente sinal genérico e **3** ficaram inconclusivas. Dos três jobs aprovados, **nenhum** foi classificado como incidente. Um sinal genérico **não identifica a causa raiz**. Não foi feita adjudicação independente do motivo real de todas as falhas, portanto os números **não representam taxa de acerto**. Não é defensável afirmar que a meta de 90% de classificação correta foi alcançada.

## Segurança e complexidade

A rotina de correlação de marcadores foi reforçada para busca de janela conjunta mínima por deslizamento, evitando a busca potencialmente quadrática em logs com muitos marcadores repetidos. Os testes devem exercer 25 mil linhas densas sem mudar os resultados relevantes.

## Bloqueios finais

- Validar todos os checks do SHA atualizado da PR #258, em especial testes de desempenho, Android e CodeQL.
- Validar o relatório da PR #257 no seu workflow operacional; a versão em draft só foi exercitada em testes sintéticos. Os workflows `workflow_run` continuam usando a definição da `main`.
- Ampliar a amostra para tipos de falha menos representados e verificar com revisão humana a causa real e eventuais falsos positivos. Não elevar a nota com base apenas em ausência de incidentes detectados.
- Definir retenção, acesso e saneamento de logs antes de qualquer ingestão automática; proibir tokens, identidades ou trechos brutos em relatórios públicos.
- Manter branches e PRs separadas e **não fazer merge, release ou deploy automático**.

Este registro é um incremento de avaliação, não aceitação final do projeto.
