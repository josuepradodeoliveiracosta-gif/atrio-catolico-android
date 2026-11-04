# Transações do Guardião — prova no Firebase Emulator

Executado **somente** na suíte Firestore/Auth Emulator `demo-atrio-v11`
em `tests/security/guardian-firestore-transaction-emulator.test.mjs`.
Utiliza o adaptador REST real do Guardião com `Authorization: Bearer owner`,
reconhecida somente no emulador, e rejeita outros projetos, hosts ou
credenciais reais. Não existe conexão com Firebase/Cloudflare de produção.

O teste valida quatro cenários:
- marcador de exclusão **ausente**: commit de QA permitido;
- marcador de exclusão **presente**: nova gravação negada e documento destino ausente;
- revisão original **desatualizada**: transação não grava parcialmente;
- revisão atual e marcador ausente: verificação combinada e commit bem-sucedidos.

Uma falha não altera a autorização de release e **deve manter a CI vermelha**.
O teste apenas homologa a semântica da transação no emulador; não prova
 IAM de produção, resistência a operações já em andamento em Cloudinary/FCM,
uso correto de marcadores no backend implantado ou exclusão real.


### Compatibilidade com o Firebase Emulator

A revisão anterior travou durante GET de documento com `?transaction=` no
emulador (Firebase firebase-tools issue #3293). O adaptador usa agora
`documents:batchGet` com `newTransaction:{readWrite:{}}`, extrai o token
da resposta e valida todas as linhas, inclusive documentos ausentes.
Somente depois emite `:commit` com a mesma transação. Resposta truncada,
documento duplicado, token ausente, versão diferente ou erro HTTP
interrompem o fluxo. O timeout REST está limitado a 15 segundos para
falhar fechado em vez de manter o scanner preso por minutos.

É uma correção de API com testes simulados; a CI com o Firebase Emulator
deve ser aprovada separadamente. Não houve deploy ou liberação.


## Compatibilidade com streaming REST do batchGet (01/11/2026)

A documentação oficial do Firestore define `batchGet` como uma **resposta
streaming**, não obrigatoriamente um único objeto JSON. A leitura da branch
passou a aceitar tanto arrays JSON (Firebase Emulator) quanto registros JSON
separados por linhas ou espaços (REST externo). O tamanho da resposta é
limitado a **4 MiB** e a **16 registros**, com recusa segura de JSON truncado,
UTF-8 inválido, payload escalar, resultados vazios e contagem excessiva.

A CI do motor Guardião executa os testes sintéticos de parsing/commit;
os testes E2E no Firebase Emulator continuam necessários. A correção é
preparatória para produção: **não prova que as credenciais, Worker IAM ou
os serviços reais estejam operacionais**. Nenhuma chave, deploy ou evidência
de privacidade foi alterada.
