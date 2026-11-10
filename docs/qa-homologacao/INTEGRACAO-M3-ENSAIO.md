# Ensaio de integração QA do marco 3 — PRs #218–#226

**Somente branch experimental aditiva. Nenhum merge na PR #193 ou main.**

O conjunto das nove PRs contém **35 arquivos novos, sem nomes duplicados**.
Esta branch agrega os blobs Git SHA imutáveis diretamente (sem editar
as PRs fonte) e executa as suítes juntas, com três jobs independentes:

- **Contrato:** verifica a integridade de cada blob, compõe as Rules
  offline e executa todos os testes Node e Python de idade, preflight,
  retenção, política #200, incidentes, solicitações e evidências.
- **Firebase Emulator:** executa ambas as matrizes de segurança de
  convites e moderação nas Rules QA e de paridade, sem Firebase remoto.
- **Revisão GitHub:** consulta apenas metadados oficiais de oito PRs
  anteriores e respectivos workflows; uma alteração de SHA ou falha
  bloqueia o relatório READY_FOR_HUMAN_REVIEW.

Os checks são testes de **coexistência dos módulos**, não homologação
em produção, não definem fornecedor de aferição 18+, SLA de moderação,
prazos de retenção, políticas jurídicas, perfil IAM ou liberação de QA.

O manifesto contém exclusivamente números de PR, paths e SHA de
blobs do Git. Não contém segredos, dados de pessoas ou protocolos.
Um resultado verde indica apenas ausência de conflitos nas fontes
testadas. A issue #200, a aprovação de políticas e a autorização
específica de implantação QA continuam obrigatórias. A PR de ensaio
permanece draft; qualquer incorporação posterior será submetida a
revisão de diffs e validação em novos commits.

**Barra oficial: 2/7 (29%). Marco 3 NO-GO.**
