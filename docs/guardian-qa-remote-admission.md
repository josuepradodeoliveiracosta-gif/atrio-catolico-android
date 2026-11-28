# Admissão remota QA V2 (somente leitura)

A prova histórica WIF da PR #47 era leitura única da fixture, não segregação de escrita. A identidade existente é leitora; não deve ser reaproveitada para escrita ou ativação. As Rules demo já passaram no GitHub, mas não se aplicam a tokens OAuth de contas IAM.

Execute `python3 scripts/guardian_qa_remote_readonly_audit.py` no Debian autenticado (gcloud e gh). A auditoria consulta somente metadados do projeto QA V2 e ambiente GitHub guardian-qa, sem tokens, dados Firestore, alterações de IAM, deploy ou billing. Saída 2 é intencional: até mesmo todos os controles diretos OK não provam CEL restritivo, acesso efetivo e segregação dos dois futuros papéis. Papel personalizado ou configuração diferente exige revisão, não mudança automática. A lista de branches esperadas vem da documentação keyless anterior. Não ampliar WIF para a branch de testes.

Critério de passagem: evidências de IAM efetivo, validação independente da configuração e identidades de triagem/ativação sem acesso direto de servidor ao banco. A reserva de 12 propostas no emulador não é a cota global. Sem Cloud Run, Blaze, chaves, criação de serviços ou alterações na produção. A auditoria não é executada automaticamente em CI, que testa apenas o avaliador com fixtures.
