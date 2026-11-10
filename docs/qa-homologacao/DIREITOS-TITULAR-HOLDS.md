# Átrio Conversas QA — direitos dos titulares e impedimentos legais

**Minuta de procedimento, sem aprovação de tratamento ou implantação.**
Nenhum usuário real é acessado. Não executa exportação, modificação,
eliminação, alteração de backup nem comunicação ao titular.

## Roteiro para revisão jurídica/privacidade e operacional

| Solicitação | Regra de avaliação futura | Riscos ainda pendentes |
| --- | --- | --- |
| Acesso | Confirmar identidade e escopo, acesso mínimo e entrega segura | Não copiar histórico privado de outros participantes |
| Correção | Confirmar titularidade, versão e impactos em protocolos/evidências | Não alterar cópias probatórias indevidamente |
| Eliminação | Inventariar coleções/subcoleções e backups; avaliar base jurídica, impedimentos e denúncia aberta | Não executar exclusão sem prazos e salvaguardas aprovados |
| Oposição | Receber e avaliar objeção pelo procedimento humano definido | Não confundir solicitação com decisão automática |
| Revisão/contestação | Roteiro de recurso e verificação independente | Identificação de revisor e prazos ainda pendentes |

Classes consideradas: DMs, mensagens de grupos, denúncias, convites,
itens ocultos, metadados, elegibilidade 18+, preferências, logs e backups.
No Firestore a remoção do documento pai não apaga automaticamente suas
subcoleções. Requer confirmação própria de cada descendente.

## Prova apenas sintética

`scripts/qa_rights_holds_review.mjs` aceita somente marcadores
predefinidos de solicitações de laboratório. Retorna contagens agregadas
de titulares não verificados, legal holds, denúncias, recursos,
subcoleções não revisadas e pedidos de backup.
Nunca aceita identificadores, nomes, textos ou dados pessoais como
campos adicionais; não possui rede, Firebase ou SDK administrativo.
A saída é sempre **NO-GO**, `erasuresPerformed=0` e
`accessExportsProduced=0`, mesmo se a fixture contiver `approved=true`.

## Decisões humanas pendentes

Fundamentos e prazos por coleção, canais e responsabilidades,
controle de identidade e autenticidade, tratamento de retenção legal,
apelações, preservação de denúncias, revisões e auditoria devem ser
definidos/avaliados na issue #200 e revisados por pessoal responsável.
Não supor que direitos do titular sempre autorizam exclusão instantânea
nem que a existência de denúncia autorize retenção ilimitada.

QA geral: **2 de 7 marcos (29%)**, marco 3 ainda NO-GO.
