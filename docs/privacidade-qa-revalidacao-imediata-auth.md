# Privacidade — revalidação de última milha antes do Auth (QA)

Etapa da PR #98, somente com Firebase Auth/Firestore Emulator, SQLite e serviços fictícios. Nenhuma operação em contas reais.

**Risco identificado:** a leitura independente do Firestore pode demorar após a verificação de retenção, workers, mídias e D1. Uma pendência criada nesse intervalo invalidaria a autorização anterior, apesar de o lease SQLite ainda estar ativo.

O contrato `removeQaAuthAfterReconciliation` agora exige `preRemoteCheck` sempre que recebe `removeRemote`. Após finalizar `assertQaReconciled`, revalida o callback e testa novamente o lease. O executor de QA usa esse callback para reler o congelamento dos Workers, o freeze persistido do Firestore, a ausência de mídias Cloudinary, as cinco fontes D1 do Avatar e a decisão de retenção correspondente à solicitação atual. Uma verificação ambígua (resultado diferente de `true`), erro, retenção inválida ou perda do lease bloqueia a chamada de remoção no Auth.

Os testes injetam uma pendência de retenção DURANTE uma consulta Firestore assíncrona, uma perda de lease DURANTE a verificação final, resultados ambíguos e um fluxo positivo. Verificam que a remoção remota não ocorre e a segunda conta permanece intacta.

**Limite essencial:** o callback é uma salvaguarda QA, não uma transação distribuída. Mesmo uma revalidação imediatamente antes do Auth não previne disputas entre serviços reais sem autenticação/IAM, fence durável global e sincronização de todos os escritores. O mecanismo de produção permanece desabilitado e a issue #72 aberta.
