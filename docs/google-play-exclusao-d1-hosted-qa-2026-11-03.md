# Drill de limpeza D1 hospedada sob congelamento — QA privado (03/11/2026)

**Estado:** implementação candidata, sem autorização de produção. O drill não possui rota HTTP pública, não apaga usuários, Cloudinary, Firebase ou FCM e não pode validar a publicação na Play Store.

## Pré-requisitos rígidos

- Worker privado `atrio-privacy-freeze-qa-internal` vinculado **somente** ao banco `atrio-privacy-freeze-stage-fixtures`, com os cinco secrets HMAC anteriormente existentes e nenhuma URL pública.
- As identidades fictícias `qa-freeze-alice` e `qa-freeze-bob` ativas; nenhum caso `qa_deletion_cases`, operação em trânsito, retenção `qa_provider_fixture_holds` ou reconciliação anterior.
- Os três canários hospedados `avatar`, `guardian`, `push` devem estar em `completed`, e nenhum cron temporário de cliente pode permanecer ativado.
- Uma lista sintética de três referências para cada identidade (`avatar_d1_pointer`, `cloudinary_qa_pointer`, `push_registration_pointer`). Não são recursos ou tokens reais. A outra conta é controle e **deve permanecer intacta**.
- Migration `0005_qa_provider_drill_once.sql` aplicada **apenas no D1 QA**. Caso fixo `fa00bbaa-4a09-4fd2-b399-001122334455`; execução fixada em `qa-hosted-provider-20261103-a`.

## Execução e garantias

O handler `scheduled` do coordenador é estritamente limitado ao dia 03/11/2026 (UTC), ao cron `* * * * *` e a bindings do Worker de QA; não existe endpoint externo. Ele faz:

1. Verificação integral do estado do D1, incluindo as duas contas e três canários anteriores.
2. Reserva atômica em `qa_provider_drill_once`. Uma vez gravada a tentativa, **jamais há retry automático**, mesmo que a operação falhe ou tenha resultado ambíguo.
3. Transição `active → draining → frozen` de Alice pelo barrier real de QA no D1 hospedado; Bob permanece `active`.
4. Abertura do caso e registro **sintético** do checkpoint `firestore_reconciled`; não foi executada remoção Firestore nem uma atestação HMAC do papel Guardião nesta etapa. É apenas uma condição para testar o algoritmo de D1.
5. Execução do módulo `qa-provider-reconciliation.js`, que verifica a autorização de uma única execução, o estado de freeze, fase=1, manifesto, ausência de operação em trânsito/retention hold, e realiza `db.batch` com journal e exclusão de três referências fictícias, seguido de SELECT independente.
6. Grava `verified` ou `failed` no D1, sem reinterpretar timeout como sucesso.

**Cuidado com a evidência:** uma conclusão `verified` valida **exclusivamente** o caminho Worker QA hospedado → barrier/ledger D1 → exclusão transacional de identificadores fictícios. Não valida a proteção de todos os caminhos de produção, a exclusão de mídias no Cloudinary, revogação de FCM, remoção de Firebase Auth, retenção ou conformidade Play Store.

## Auditoria de saída

Consultar apenas o D1 de QA:
- `qa_provider_drill_once`: exatamente 1 linha, state `verified`, run/case fixos.
- `qa_privileged_accounts`: Alice `frozen`, Bob `active`.
- `qa_deletion_cases`: caso Alice em `step=1` (restantes ainda não executados).
- `qa_provider_fixture_refs`: 0 refs Alice, 3 refs Bob, sem surpresa.
- `qa_provider_fixture_reconciliations`: 1 journal Alice.
- `qa_privileged_operations`: 0; `qa_provider_fixture_holds`: 0.
- Os três canários anteriores permanecem `completed`.
- Gatilho do Worker e dos três clientes: **nenhum agendamento** após a verificação.
- Deployments dos Workers reais `atrio-avatares`, `atrio-guardian-v2`, `atrio-push`: sem alterações.

**Status de conformidade:** `releaseAuthorized:false`; manter a PR em draft e a issue de exclusão aberta até todas as integrações reais e evidências de Play Store serem aprovadas. Nenhum backup ou dado real deve ser modificado.
