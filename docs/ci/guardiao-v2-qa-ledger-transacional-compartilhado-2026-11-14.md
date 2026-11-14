# Guardião V2 — ensaio de transações compartilhadas em QA (somente memória)

**14/11/2026.** Continuidade da PR #290. Esta entrega testa uma nova **fronteira transacional simulada**, separada dos mediadores, para reduzir o risco de duplicidade, replay e escritas parciais ao projetar o futuro serviço privado.

## O que foi realmente implementado

`scripts/guardian_v2_qa_shared_ledger.py` oferece:
- `SharedQaLedger`: um único ledger sintético em memória, com `RLock` e cópia de trabalho. Todos os dados são fictícios, sem projeto Google existente.
- `IndependentQaMediator`: objetos distintos que compartilham o ledger por referência, não token, rede ou banco. As identidades vêm do **teste**, jamais do payload.
- Para `enable_nonpunitive`: aprovação sintética separada, versão esperada e alteração somente dos dois sinalizadores autorizados; parada emergencial e retenção não são alteradas.
- Para `propose_case`: política reavaliada na seção crítica, fonte sintética existente, proprietário e revisão corretos, ID derivado, não duplicidade, orçamento compartilhado e conjunto sintético caso/auditoria/aviso/orçamento sem escrita parcial.
- Antes de aceitar qualquer operação, reaproveita o contrato `simulate_qa_intent`. Solicitações `commit`, `patch`, `delete`, role forjado, revisão stale e alterações fora da lista são negadas.
- `fail_next_commit_for_test` introduz uma falha **sintética antes da publicação do novo estado**, para provar que nenhuma das quatro partes é parcialmente gravada no objeto Python.
- `snapshot` retorna cópia defensiva; saídas incluem `production_authorized: false`.

`scripts/test_guardian_v2_qa_shared_ledger.py` verifica dois objetos de mediador independentes conectados ao **mesmo** ledger, limite compartilhado, 16 propostas concorrentes, replay, aprovação, CAS simulado, falha e rollback local. Executa pelo workflow de segurança existente.

## Limites técnicos CRÍTICOS

- **Não há Firestore, SDK, emulator, rede, servidor Cloud Run, WIF, ID token real, serviço de produção, custo ou persistência.**
- O `RLock` funciona apenas em um único processo Python. Dois objetos não são duas instâncias Cloud Run, e este ensaio **NÃO prova transações distribuídas, isolamento IAM, retries, cotas globais ou consistência em Firestore**.
- `fail_next_commit_for_test` simula rollback **antes** de publicar o estado; não testa falhas de rede após um commit real nem efeitos externos como envio de notificação.
- O CAS de versão e o budget são geridos pelo próprio ledger local. Não inferir que o contrato de persistência Firestore está implementado.
- A lista de coleções e a transação real precisarão ser confirmadas em QA independente, não copiadas cegamente deste fixture.
- Nunca executar efeitos externos dentro de um callback de transação que possa sofrer retry. A documentação oficial do Firestore explica que transações podem repetir em caso de conflito, e todos os reads devem vir antes dos writes.

## Próxima fase (depende de homologação autorizada)

1. Confirmar projeto e banco QA distintos de produção, limites de custo, aprovação, identidades separadas, WIF e plano de rollback.
2. Preparar backend privado que use Firestore **de verdade** em uma identidade de serviço exclusiva, impedindo os chamadores de acesso direto a dados.
3. Na transação real, ler política, fonte, caso e orçamento **antes de qualquer write**; exigir precondições, idempotência e ausência de efeitos colaterais fora da transação. Testar concorrência com **duas instâncias reais** e retries.
4. Executar os 16 testes autenticados de IAM/rotas da PR #290 e conservar evidências externas, sem dados privados em CI público.
5. Produção continua `NO_GO` até revisão humana e autorização separada. Nenhuma migração de cron, IAM, Firestore, Firebase ou `main` por esta entrega.

## Teste local no Android/Termux

```bash
python3 -m unittest scripts.test_guardian_v2_qa_shared_ledger -v
```

Referências técnicas externas para etapa futura:
- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://docs.cloud.google.com/python/docs/reference/firestore/latest/google.cloud.firestore_v1.transaction
- https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Precondition
