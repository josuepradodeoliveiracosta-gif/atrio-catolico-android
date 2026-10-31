# Privacidade — bloqueio conjunto de autor e destinatário no FCM (somente QA)

**31/10/2026 | PR #98 | Issue #72 aberta | Sem deploy nem exclusão real.**

## Lacuna verificada

O adaptador de testes do Push já bloqueava FCM por `recipientUid`, mas em notificações de **resposta** um autor poderia ser congelado durante a exclusão da conta e ainda enviar um aviso para um destinatário ativo. O Worker atual tem dois formatos distintos de reply:

- Envio individual associado a uma discussão, contendo `actorUid`, `postId`, `replyId`, `uid` do destinatário;
- Envio legado/degradado, com `uid` e `kind:'reply'`, **sem autor**.

O segundo formato não contém informação suficiente para proteger o autor e deverá permanecer **rejeitado nos testes** até haver rastreabilidade completa. O Worker original, ainda não modificado, não tem essa proteção.

## Contrato de QA adicionado

- `qa-privileged-write-barrier.js`: permite que `push_fcm_send` tenha o escopo explícito `{actorUid,recipientUid}`, *além* do escopo de mensagens individuais administrativas já usado. O ingresso SQL inclui ambas as contas, atomicamente, num único ticket. Não permite contas fora de `qa-freeze-alice` e `qa-freeze-bob`.
- `qa-push-outbound-gate.js`: só aceita `kind:'reply'` com autor verificado no fixture e identificadores fixos `qa_post/qa_reply`; responde com erro antes do I/O quando há autor ausente, falsificado, congelado ou destinatário congelado. Para eventos de revisão e administração sem autor, conserva escopo somente do destinatário.
- Testes `qa-push-outbound-gate.test.js` cobrem duas contas, negação atômica de envio, falta de escopo, falha externa, verificação inconclusiva e preservação dos tickets para reconciliação.

## Limitações e risco residual

Este avanço só protege **o adaptador de transporte dos testes**, que usa respostas HTTP fictícias e SQLite descartável. **Os Workers implantados não importam esta barreira**. Nenhuma entrega real FCM, D1 ou Firestore foi testada, nenhum token real foi lido e nenhuma função destrutiva foi habilitada.

**Permanece obrigatório** antes da Google Play: transportar a identidade do autor em todos os fluxos de resposta, inclusive o modo degradado; eliminar e testar bypass de todas as rotas de Push/FCM e tópicos; coordenar D1, threads, fila, Guardião e dispositivos com congelamento durável; verificar IAM, retenção, portal público e executor seguro.

O fan-out por tópico ainda não possui um cadastro confiável e completo de participantes inscritos; `qa-push-outbound-gate.js` o rejeita em vez de fingir que os destinatários foram inventariados.

`productionIntegrated=false`; `safeToDeleteRealAccounts=false`. `main`, backups, certificados, APK/AAB e OTA preservados.
