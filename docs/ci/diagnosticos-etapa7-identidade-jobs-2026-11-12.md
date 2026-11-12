# Etapa 7 — Verificação read-only de proveniência de jobs (QA)

Data: 12/11/2026 — PR #259 (draft), sem alterações na main ou produção.

## Objetivo e fluxo

1. O relatório já existente `ci-report.json` produz `ci-diagnostics.json` com uma fila limitada de até 12 pares run/job candidatos, somente se o check terminou em `failure` ou `timed_out`.
2. O novo `scripts/ci_log_identity_verifier.py` valida o manifesto local e consulta apenas metadados read-only do GitHub Actions em `/actions/runs/{run_id}` e `/actions/jobs/{job_id}`.
3. O job só recebe `identity_verified=true` quando repositório de execução e origem, SHA do commit, IDs, estado concluído, conclusão exata e número da tentativa conferem entre os endpoints e o snapshot.
4. A saída `ci-job-evidence.json` e uma seção do `ci-report.md` apresentam exclusivamente IDs e códigos fixos de resultado. Em caso de falha, acesso indisponível ou informação divergente, **não há verificação positiva**.
5. A verificação é anexada ao workflow de relatório já existente, com as permissões `contents:read`, `checks:read` e `actions:read` que ele já tinha. Nenhum workflow, gatilho ou permissão novo.

## Limites e proteções

- **Nenhum log bruto é baixado, examinado ou publicado nesta etapa.** A verificação de identidade é um pré-requisito para possível leitura futura, não uma autorização genérica de acesso.
- Respostas de metadados limitadas a 64 KiB cada, até 12 jobs por snapshot, sem aceitar URLs fornecidas pelo check como alvo de API. A saída não copia corpos de resposta, mensagens de erro ou credenciais.
- O SHA validado é o SHA histórico do relatório: **não prova** que continua sendo o HEAD da PR.
- O programa não atribui causa raiz, não executa reruns, correções, merges, releases, publicações ou deploys.
- O relatório automático `workflow_run` só usa a versão do workflow presente na branch padrão do GitHub. Testes e homologação de `workflow_dispatch` na branch de QA não significam ativação na main.
- Se a fila estiver ausente, corrompida, exceder limites ou contiver registros ambíguos, a execução falha fechada e não consulta a API.

## Aceite e teste

- Os testes offline `scripts.test_ci_log_identity_verifier` cobrem aprovação de metadados coerentes, repositório e SHA divergentes, job e estado incorretos, tentativa obsoleta, filas inválidas, limite de resposta, falhas de rede sem vazamento e CLI real sem token.
- A suíte foi incluída nos gates existentes de `selos-ci.yml` e `ci-quality-report.yml`. Resultado conclusivo depende dos checks do commit final da PR.
- Um teste real de metadados **com job falho** só ficará comprovado quando houver candidato legítimo e acessível; sem isso, o fluxo de sucesso é demonstrado com respostas simuladas e o fluxo operacional vazio pode ser confirmado em QA.

A PR permanece em rascunho; integração na main exige revisão e autorização explícita.
