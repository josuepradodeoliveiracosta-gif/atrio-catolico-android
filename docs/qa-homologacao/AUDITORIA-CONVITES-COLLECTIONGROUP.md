# Auditoria de consultas de convites no Firestore QA

**Estado: somente emulador, sem deploy.** PR isolada direcionada a branch de
homologacao #193. Nao altera as Rules oficiais nem as candidatas.

## Por que auditar

A permissao `match /{path=**}/atrioGroupInvites/{inviteId}` suporta
`collectionGroup`. Regras Firestore sobrepostas podem conceder acesso
quando QUALQUER match autoriza a consulta. A matriz dedicada comprova
que queries amplas ou de outros usuarios nao podem ler convites privados.

## Evidencia pretendida

A nova suite usa apenas `demo-atrio-v11` e documentos ficticios.
Roda em duas compilacoes offline de Rules:
- `qa-general.generated.rules` (QA restritivo).
- `qa-parity.generated.rules` (base Git imutavel com fragmentos QA).

Testa destinatario, administrador e consulta filtrada, alem de
terceiros elegiveis, membros sem papel, visitante, email nao verificado,
query sem filtro, consulta a outro UID e filtro multivalorado.
Tambem testa revogacao do atestado 18+ ficticio, expiração do acesso
a grupos, suspensao administrativa e recuperacao por fixture.

## Limites

18+ e APENAS um dado sintetico no emulador: nao e afericao real.
A colecao `atrioGroupInvites` deve permanecer exclusiva: novos
usos homonimos exigem nova revisao da regra recursiva.
Nenhum teste do emulador comprova que a Rules remota foi publicada,
nem libera Worker, FCM, chat ou usuarios reais.

Issue #200 permanece bloqueando metodo real de idade, moderacao,
retencao e autorizacao de ativacao QA. **Marco 3 pendente, total 2/7 (29%).**
