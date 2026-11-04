# Proteção de checkpoint e resultado final após consulta Auth — 04/11/2026

Esta mudança no executor **QA isolado** complementa a verificação anterior imediatamente antes de `auth.remove()`.

## Corrigido

Uma leitura remota `auth.exists()` pode terminar depois de novo registro Firestore, referência de outra conta, mídia Cloudinary/D1 ou dispositivo FCM. Mesmo quando Auth **já foi removido**, os caminhos `verify(delete_auth_last)`, `verify(verify_final)` e `verifyRecovery(...)` não podem avançar checkpoints ou reportar sucesso apenas porque Auth retornou ausente.

O executor agora revalida congelamento e drenagem, inventário Firestore e referências estrangeiras/retention, mídia/D1, FCM e lease/aprovação novamente **após** o lookup Auth em ambos os caminhos. Resíduo, provedor desconhecido ou revogação falham antes do checkpoint. Não se tenta desfazer um efeito remoto já concluído.

## Regressões automatizadas

- Nova referência Firestore introduzida no lookup Auth **após a remoção** impede checkpoint `delete_auth_last`.
- Novo dispositivo no lookup final de caso concluído impede o retorno enganoso de sucesso.
- Nova mídia após leitura de Auth ausente em recuperação revista (epoch=2) impede reconciliação de um checkpoint perdido.
- Ausência comprovada, sem resíduos, reconcilia checkpoints perdidos sem uma segunda chamada de exclusão.

Somente contas `qa-delete-*` fictícias e objetos de teste; **não há novos endpoints nem deploy**. O projeto permitido segue `demo-atrio-v11`. QA não significa homologação jurídica, IAM de produção ou autorização Play Store. Os Workers de produção e seu backup não são alterados.
