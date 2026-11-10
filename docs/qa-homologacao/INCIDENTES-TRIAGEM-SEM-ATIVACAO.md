# Átrio Conversas QA — triagem de incidentes e recursos

**Modelo de mesa (tabletop) NÃO aprovado como política operacional.**
Nenhum dado real, ticket, acesso administrativo, notificação,
bloqueio de conta, sanção ou exclusão é produzido.

## Fluxo que precisa de aprovação humana na issue #200

| Fase de revisão | Evidência que precisa existir | Pendência atual |
| --- | --- | --- |
| Recebimento | Canal de denúncia e identidade do solicitante, sem acesso a históricos alheios | Dono do canal e regras para ex-membros |
| Proteção inicial | Revisão de risco iminente ou a menores, sem atribuição automática de prioridade | Critérios de gravidade e responsável por urgências |
| Atribuição | Credenciamento e disponibilidade de moderador com mínimo privilégio | Equipe, substituto, segregação de funções e horários |
| Preservação | Evidência mínima, denúncia aberta, impeditivo legal e trilha de acesso | Base jurídica, legal hold e duração por classe |
| Análise humana | Justificativa, contexto mínimo e procedimento de decisão | Categorias de sanções, proporcionalidade e contestação |
| Contestação | Canal independente, revisores, contraprovas e prevenção de retaliação | Prazo, identidade dos revisores, etapas de recurso |
| Escalonamento | Encaminhamento a responsáveis competentes para risco imediato | Contatos, limites e protocolo aprovado de emergência |
| Encerramento | Revisão humana, retenção e direitos dos titulares | Nenhuma etapa de descarte/expurgo autorizada |

## Laboratório técnico

`scripts/qa_incident_tabletop.mjs` contabiliza apenas sinais sintéticos:
intake ausente, possível urgência, responsável indisponível, acesso
não credenciado, evidência ausente, recurso pendente e ex-integrantes.
Todos os resultados são **NO-GO**, ações reais = zero.
O script não aceita IDs nem texto de denúncia. Dados ambíguos não são
convertidos em aprovação, nem uma flag `approved` do chamador concede
autoridade. Contagens não representam triagem executada.

Os testes cobrem casos positivos e negativos com isolamento e
saída sanitizada. Não integram Firebase real, Worker, FCM, e-mail,
sistema judicial ou pessoal de moderação. Não existe SLA definido.

## Deliberação obrigatória

A idade mínima 18 anos já foi definida para o chat, mas a aferição
confiável, equipe, recurso, escalonamento, retenção e aprovação de
implantação continuam pendentes na issue #200.
**QA geral: 2/7 marcos (29%), marco 3 NO-GO.**
