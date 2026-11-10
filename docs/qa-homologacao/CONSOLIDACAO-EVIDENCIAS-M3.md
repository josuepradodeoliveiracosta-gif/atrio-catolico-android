# Revisão consolidada das evidências QA do marco 3

**Conferência read-only de metadados, sem autorização de produção,
QA remoto, merge, idade, política ou retenção.**

## Motivo

A PR principal #193 contém o ambiente QA em rascunho. As PRs #218–#225
acrescentam laboratórios isolados, cada uma com workflow vinculado a
um SHA específico. Um workflow antigo verde não prova um novo commit.

Este gate cruza, por GETs fixos do GitHub, o estado atual de oito PRs,
seus SHAs, os runs específicos e o estado aberto da issue #200.
A falha ou a troca do SHA de um único item muda o relatório para
`EVIDENCE_INCOMPLETE` e resulta em falha de CI. Da mesma forma,
mudanças em `main`, no head da #193, ou um encerramento inesperado
da issue #200 obrigam reavaliação.

## Natureza da prova

- **19 GETs fixos**: 8 PRs filhas, 8 runs registrados, main, PR #193 e issue #200.
- Cada run deve ter `status=completed`, `conclusion=success`,
  evento `pull_request`, SHA e nome de workflow esperados.
- Cada PR deve continuar aberta e draft, apontando à branch QA
  original e no próprio repositório; sem supor merges implícitos.
- Saída saneada: apenas estado, IDs de PR/run e códigos de problemas,
  sem bodies, revisores, comentários, protocolos privados ou credenciais.
- `READY_FOR_HUMAN_REVIEW` significa apenas integridade de evidências,
  **NUNCA GO**. Mesmo nesse caso `status=NO_GO`, sem autorização
  de deploy, produção, merge ou aprovação de política.

## Limites

Workflows de laboratório não demonstram verificação etária real,
segurança da Rules publicada, integração Worker, APK físico,
moderação operacional, legalidade ou aprovação da issue #200.
Essa ferramenta não deve virar autorizador automático, pois apenas
confere metadados do GitHub. Antes de integrações de branches,
revalidar manualmente mudanças e checks no SHA atual.

**Marco 3 segue bloqueado. QA geral: 2/7 (29%).**
