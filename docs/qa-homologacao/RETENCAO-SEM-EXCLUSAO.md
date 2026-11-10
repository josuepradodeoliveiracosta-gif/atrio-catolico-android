# QA de retenção — inventário de evidências sem exclusão

**Estado: NÃO aprovado para implantação, retenção ou eliminação.**
Laboratório sintético criado em uma PR draft separada da PR #193.

## Classes inventariadas

Contempla mensagens diretas e de grupos; denúncias diretas e de grupos;
convites; histórico ocultado localmente; metadados de chats/grupos;
elegibilidade 18+ e de grupos; preferências; trilhas de auditoria;
e backups. O relatório retorna somente nomes de classe e contagens.

## Riscos modelados

- `legalHold=true`: impedimento legal explícito, requer preservação.
- `openReports=true`: protocolo/denúncia aberta, requer preservação.
- `appealPending=true`: recurso pendente, requer revisão humana.
- `parentMissing=true` / `unreviewedChildren=true`: risco de órfão
  porque no Firestore a exclusão de um documento pai não apaga
  automaticamente seus documentos descendentes.
- Ausência ou tipo ambíguo dos indicadores: **desconhecido**, nunca
  equivalente a ausência de impedimento.
- Indicadores todos explicitamente falsos: apenas `reviewOnly`,
  **nunca permissão para apagar**.

## Segurança da execução

`scripts/qa_retention_evidence_inventory.mjs` é função pura que aceita
somente fixtures e produz um resumo imutável. Não acessa rede, Firebase,
Cloudflare, sistema de backups, usuários ou mensagens reais. Não gera IDs
de itens, listas de exclusão, comandos, credenciais ou períodos de
retenção. Um objeto `policy` com `approved=true` não altera o resultado:
**NO-GO**, `deletedCount=0`, `deletionCandidateCount=0`.

Os testes também verificam o simulador já existente
`cloudflare/push-worker/src/retention-plan.js`. Nele, `days` e
`approvedBy` são parâmetros de **simulação**, não decisões aprovadas.
O resultado do simulador permanece apenas `dry_run_only` e nunca apaga.

## Decisões ainda necessárias

A issue #200 continua exigindo políticas por classe, obrigações legais,
proteção de evidências, direitos do titular, responsáveis, controle
de acesso administrativo e planos de revisão/rollback. Será necessária
revisão jurídica e autorização QA específica antes de qualquer
política ou job de eliminação. Não alterar `minorPolicyApproved`,
`firestore.rules`, Workers, backups, repositório principal ou produção.

**Marco 3 segue EM ANDAMENTO / NO-GO. QA geral: 2/7 = 29%.**
