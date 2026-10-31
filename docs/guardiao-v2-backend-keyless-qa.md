# Guardião V2 — próximo estágio do backend keyless (QA, NÃO ATIVO)

## Evidência aproveitada, sem repetir

A PR #47, head 982990f94eefbac4c959e3bf64c4662b04dffc94, homologou a autenticação GitHub Actions OIDC → Google STS/WIF → OAuth temporário (300 s), no job 124407888885, workflow 41156806802, tentativa 2, incluindo GET 200 da fixture QA. A PR #46 já está na main. Não repetir os 143 testes Node, o emulador Android ou a prova WIF sem mudança relevante.

## Menor caminho viável, dentro de R$ 0

Para autenticação recorrente sem chave privada persistente, manter a execução privilegiada no GitHub Actions: cada job obtém token temporário por OIDC/WIF, faz trabalho limitado e encerra. O Cloudflare Worker QA **não recebe** essa identidade e continua somente heartbeat, desativado para moderação. O repositório foi verificado como **público**; runners GitHub-hosted **padrão** são gratuitos para repos públicos, mas o Firestore tem sua própria cota e cobranças potenciais que precisam ser monitoradas.

**Limite arquitetural:** cron do GitHub roda SOMENTE na branch padrão (main); o provedor WIF atual autoriza somente duas branches de QA (feature/guardiao-autonomo-20261029 e feature/guardiao-v2-wif-prova-qa-20261030). Portanto, um agendamento real necessitaria nova aprovação para admitir main, verificação IAM independente e merge/deploy autorizados. Agendamento GitHub não garante disponibilidade em tempo real (pode atrasar ou falhar e pode desativar após 60 dias sem atividade pública).

## Implementado nesta branch isolada

- qa-keyless-cycle.js: módulo de leitura única **apenas da fixture literal posts/qa_post_1 do projeto QA**, limite 8 KiB/6,5 s e sem redirecionamentos, usa o classificador já existente em memória e retorna somente contadores. Reutiliza validateQaWifContext da PR #47; rejeita evento schedule, main e flags de produção.
- qa-keyless-cycle.test.js: cinco testes novos de autorização, leitura, classificação, ausência de conteúdos, erros e limites. Totalmente offline e sem requisições reais.
- Workflow de CI na branch desta PR: **somente push com arquivos alterados**, sem id-token, sem secrets, sem cron, sem deploy e sem tocar no Google Cloud.
- A **preparação da ligação** ao workflow manual WIF está incluída agora nesta branch: depois que o código for integrado **com autorização específica** à branch QA autorizada, o workflow usará o ciclo de classificação no lugar da sonda, mantendo **somente um GET** da fixture. Este commit NÃO executa o workflow e não habilita cron, Worker, escrita, moderação ou leituras remotas.

## Aprovações ainda necessárias — NÃO EXECUTAR

1. Revisão de segurança do ciclo e de privacidade do documento QA; aprovar eventualmente portar este módulo à branch QA já autorizada, sem ampliar IAM, para uma prova de classificação sintética (somente após motivo concreto para fazê-la).
2. Para agendamento verdadeiro, escolher uma arquitetura: GitHub Actions na main com provedor WIF restrito ao workflow/branch e **consentimento IAM separado**, ou backend com identidade própria viável e menor privilégio. Nunca guardar token OAuth no Cloudflare/Android. Não assumir que GitHub schedule é 24h contínuo ou instantâneo.
3. Validar cota Firestore, privilégios mínimos reais por recurso, revisão humana, rollback, orçamento e gatilho de parada antes de qualquer escrita de casos e avisos.
4. Qualquer mudança IAM, merge, deploy Firebase, Worker, APK Release, cron ou moderação real precisa aprovação específica. Não modificar backups nem Worker atrio-push.

Referências oficiais: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows ; https://docs.github.com/en/billing ; https://docs.cloud.google.com/iam/docs/workload-identity-federation

## Preparo de homologação manual (NÃO EXECUTADO)
- A execução remota WIF já homologada na PR #47 não deve ser repetida apenas para provar credenciais. A futura execução tem finalidade *nova*: verificar a classificação de dados sintéticos via o mesmo OAuth/GET.
- A branch PR #48 não está na allowlist atual do ambiente Google WIF; portanto **não** disparar o workflow nessa branch. Uma integração futura à branch QA autorizada dependerá de permissão explícita. Não ampliar allowlist ou CEL para contornar o controle.
- O contrato de um GET é checado por teste estático novo. A API do Firebase oficial continua fora de alcance e nenhuma ação do Guardião é disparada.
