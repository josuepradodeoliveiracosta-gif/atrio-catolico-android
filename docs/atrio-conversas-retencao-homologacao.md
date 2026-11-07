# Átrio Conversas — proteção de menores e retenção (minuta)

**Não é política publicada nem parecer jurídico. Nenhum prazo de
exclusão foi aprovado.**

## Proteção etária

O ECA Digital (Lei 15.211/2025), vigente desde 17 de março de 2026,
e a LGPD exigem atenção à segurança e à privacidade de crianças e
adolescentes. Fontes oficiais:
- https://www.gov.br/anpd/pt-br/assuntos/eca-digital/
- https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm

A elegibilidade de grupo depende de revisão administrativa registrada em
`users/{uid}/chatGroupAccess/eligibility` com `status=approved`,
`policyVersion` e `reviewExpiresAt` futuro. Firestore, Worker e
interface verificam vencimento. O usuário não pode conceder ou renovar
essa autorização. **Isso não implementa verificação de idade**.
É necessário decidir e homologar um mecanismo confiável de aferição
compatível com as leis e o público-alvo antes de ativar grupos.

Não pedir CPF, documentos ou data de nascimento dentro das conversas
como substituto improvisado de aferição de idade. O registro operacional
de autorização usa apenas status, versão e vencimento; eventual
integração futura terá avaliação de finalidade e minimização de dados.

## Inventário pendente de política específica

- `chats/{id}/messages`: textos privados, edições e mensagens removidas.
- `chat_groups/{id}/messages`: históricos inclusive encerrados.
- `chat_group_reports`: cópias e motivos de denúncias.
- `users/{uid}/chatHidden`: ocultação não equivale à exclusão.
- `chat_groups/{id}/atrioGroupInvites`: convites e recusas.
- `users/{uid}/chatGroupAccess`: decisões de acesso e vencimento.

## Ferramenta não destrutiva

O módulo `cloudflare/push-worker/src/retention-plan.js` é uma
função **pura, sem rede, credenciais, Firebase ou exclusão**.
Uma política não aprovada produz zero candidatos. Uma política
simulada com prazo explícito calcula apenas o total de grupos
encerrados a revisar, excluindo denúncias abertas e impedimentos
legais. Não retorna IDs, nomes nem mensagens. Sempre informa
`deletedCount: 0`.

A política real deve definir prazos diferentes para mensagens,
denúncias, convites e registros administrativos, critérios de
retenção legal, exercício de direitos e descarte seguro. Excluir
um documento pai no Firestore não exclui automaticamente suas
subcoleções. Não criar jobs de exclusão antes de aprovação
expressa, auditoria e homologação.

**Permanecem bloqueados:** a abertura de grupos sem política de
menores aprovada, os avisos sem `pushEnabled=true` e qualquer
exclusão automática ou mudança nas regras Firebase de produção.
