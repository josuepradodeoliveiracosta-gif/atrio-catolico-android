# Etapa 5 — Adjudicação dos sinais e limites de validade

Data: 12/11/2026. Proposta de QA da PR #259, sem merge ou deploy.

## Conjunto de desenvolvimento: causas verificadas em logs históricos

A inspeção manual de nove jobs falhos históricos encontrou evidências localizadas que justificam alguns sinais de **alta especificidade**. O classificador aponta a condição observada, não a cadeia causal completa. Nenhum log bruto é versionado. Foram adicionadas regras apenas quando havia texto comprovável, preciso e próximo no log, sem generalizar para toda a categoria de falhas.

| Sinal | O que a evidência mostrou | Histórico de referência |
| --- | --- | --- |
| `github_dependency_review_unavailable` | Recurso de revisão declarado indisponível no repositório, **não** uma vulnerabilidade comprovada | [42895549772](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42895549772) |
| `sqlite_closed_database` | Uso de conexão SQLite já fechada em teste QA | [42901654186](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42901654186) |
| `ci_check_pagination_guard` | Coleta CI interrompida intencionalmente ao recusar snapshot incompleto | [42894991445](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42894991445) |
| `qa_evidence_readiness_mismatch` | Teste esperava prontidão diferente do estado observado | [42914673911](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42914673911) |
| `qa_firestore_open_grant_contract` | Teste sinalizou não conformidade do contrato offline `no_literal_open_grants` | [42908852402](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42908852402) |
| `qa_case_id_contract` | Divergência de asserção da fixture `qa_case_invalid_case_id` | [41256125137](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41256125137) |
| `qa_ota_tampered_download_test` | Teste QA de rejeição de APK alterado falhou; **não** prova regressão na versão oficial | [42626966123](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42626966123) |

Os demais históricos auditados exibiam apenas falhas genéricas ou evidências insuficientes. A inferência deve continuar como `inconclusive` ou sinal genérico; não atribuir uma causa inventada.

## Conjunto independente reservado (não usado para redigir regras)

Separados **13 jobs falhos** de 2026-11-03 a 2026-11-10, que não serviram para ajustar as sete novas regras, para avaliar comportamentos conhecidos e inéditos após sua implementação:

| Execução | Classe de evidência na inspeção prévia |
| --- | --- |
| [42918247206](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42918247206) | Log insuficiente, proteção Guardião |
| [42706516214](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42706516214) | Contrato de mock SHA |
| [42882563645](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42882563645) | Erro de sintaxe de Worker |
| [42866978165](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42866978165) | Dois sinais de emulador |
| [42827440253](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42827440253) | Falha cuja causa exige avaliação mais profunda |
| [42204895698](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42204895698) | Guard de publicação OTA |
| [42489241763](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42489241763) | Rejeição de acesso no emulador Firestore |
| [42114501683](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42114501683) | Continuidade de certificado APK |
| [42737119822](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42737119822) | Rejeição de acesso no emulador Firestore |
| [42186167568](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42186167568) | Contrato de caminho de assinatura |
| [41688182521](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41688182521) | Sinal ADB offline |
| [41701161532](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41701161532) | Asserção de QA Worker Cloudinary |
| [41688182976](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41688182976) | Asserção genérica / inventário |

**Linha de base do classificador anterior, registrada antes de alterar as regras:** 3/13 jobs falhos apresentaram sinal específico, 3/13 apresentaram sinal genérico e 7/13 permaneceram inconclusivos, sem que tais proporções representem taxa de acerto. Na amostra separada, também foram verificados jobs aprovados como controles negativos: quando `job_conclusion=success`, o classificador emite nenhum sinal de incidente. O conjunto não é aleatório nem abrangente.

## Métricas e critérios

- **Cobertura de sinais específicos:** proporção de jobs falhos com pelo menos uma regra de evidência específica reconhecida. Não equivale a acerto da causa raiz.
- **Taxa de sinalização indevida em jobs aprovados:** proporção dos jobs com conclusão `success` rotulados incorretamente como incidentes; o estado é obrigatório para classificar e deve ser validado independentemente.
- **Precisão de diagnóstico de causa raiz:** **não calculável** sem adjudicação humana suficiente sobre a causa real e sua correspondência com o sinal observado.
- Cada métrica deve mostrar o denominador, o período e o critério de seleção. Não publicar percentuais de desempenho geral a partir de fixtures que foram usadas para construir regras.
- Ausência de evidência gera `inconclusive`, **não** um falso diagnóstico.
- As regras são diagnósticos informativos; sem auto-rerun, merge, correção, deploy ou acesso a credenciais.

### Bloqueios finais antes da decisão de integração

1. Atestar todos os checks do **SHA atualizado** na PR #259, especialmente Android/Firestore e CodeQL.
2. Validar em conjunto o relatório operacional se o workflow for alterado; a execução manual anterior na branch QA validou a versão anterior ao acréscimo destas regras. A mudança atual é restrita ao classificador e testes, sem mudança no workflow de relatório.
3. Executar avaliação adicional de falhas não utilizadas no desenvolvimento, com adjudicação independente e amostra representativa antes de alegar a meta de **90%**.
4. Revisão humana obrigatória antes de quaisquer merges ou mudanças de produção; regras de proteção e backups intocados.

