# Dupla verificação de todos os provedores imediatamente antes do Auth — 04/11/2026

## Problema e proteção

O executor de exclusão QA já exigia congelamento distribuído, tickets drenados, inventário Firestore reconciliado, ausência de mídia/D1 e ausência de dispositivos/FCM **antes** de consultar `auth.exists()`. Mas a consulta remota do Firebase Auth também é assíncrona, podendo durar o suficiente para surgir uma referência, dispositivo ou mídia nova.

O passo `delete_auth_last` agora exige **uma segunda reconciliação integral** após `auth.exists() === true` e imediatamente antes de `auth.remove()`: Firestore, referências estrangeiras, retenção, Cloudinary + Avatar D1, FCM e, por último, uma nova autorização, lease e congelamento/drenagem. Estado residual, desconhecido, revogado ou erro bloqueia o efeito Auth antes de começar.

Isso reduz a janela entre a checagem de provedores e a remoção irreversível. **Não oferece atomicidade entre serviços** e não autoriza uso em produção: o congelamento precisa ser aplicado em todos os Workers oficiais e todo adaptador com efeito externo deve fazer sua própria verificação de lease/fence.

## Casos adicionados

- Referência estrangeira Firestore introduzida durante a consulta do Auth bloqueia remoção.
- Nova mídia Cloudinary/D1 surgida durante essa consulta bloqueia remoção.
- Novo dispositivo FCM surgido durante a consulta bloqueia remoção.
- Teste exige uma leitura nova em TODOS os provedores entre `auth.exists` e `auth.remove`.
- Quando o resíduo é reconciliado e a execução tem revisão/lease válidos, Auth continua sendo removido por último, nunca repetido.

Os testes aqui são de interfaces sintéticas e NÃO usam credenciais reais. O projeto permitido permanece `demo-atrio-v11` e UIDs de QA; a suíte real do Firebase Auth Emulator continua sendo uma verificação distinta. A PR #71 permanece em rascunho, sem alteração de `main`, produção, backups ou Play Store.

## Validação adicional com Firebase Admin SDK no emulador

A suíte `tests/security/admin-fixture/qa-controlled-executor-e2e.test.mjs` também reproduz o intervalo com o Firebase **Auth Emulator real** e o **Firestore Emulator real**: a consulta `getUser(uid)` do Auth introduz, por injeção de teste, uma referência tardia na coleção de notificações de uma conta fictícia vizinha, simulando um escritor administrativo não protegido.

Com a segunda reconciliação, a rotina rejeita a referência, deixa o Auth da conta solicitante intacto, preserva o vizinho e mantém o checkpoint antes de `delete_auth_last`. A injeção demonstra o problema de uma leitura isolada sem fencing e a utilidade da nova checagem, mas não supre a obrigação futura de cercar **todos** os escritores administrativos distribuídos. Esta prova roda exclusivamente no projeto e nos ports emulados, sem acesso aos provedores oficiais.
