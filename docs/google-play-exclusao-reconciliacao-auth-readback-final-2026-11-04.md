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

## Validação complementar após a remoção remota Auth (emuladores)

Nova prova usa o Firebase Admin SDK de verdade, mas apontado exclusivamente para `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` e `FIRESTORE_EMULATOR_HOST=127.0.0.1:8089`. Uma conta `qa-delete-postauth-candidate` é removida no Auth Emulator; imediatamente durante o `getUser` que confirma a ausência, o teste insere uma referência fictícia tardia na conta vizinha no Firestore Emulator.

O executor exige a **segunda reconciliação após o lookup**: o Auth já está ausente, porém `delete_auth_last` NÃO recebe checkpoint; a execução falha fechada, preserva a conta vizinha e exige revisão independente antes de retomada. A imagem/mídia e o FCM são duplos sintéticos, não fornecedores reais. O teste deliberadamente não reinicia automaticamente o caso interrompido. A suíte de ledger persistente e assinaturas de recuperação permanece separada.
