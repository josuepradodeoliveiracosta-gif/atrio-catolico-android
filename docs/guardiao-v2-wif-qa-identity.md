# Guardião V2 — prova de identidade temporária, exclusiva QA

OIDC/WIF de GitHub Actions já foi usado para leitura QA na PR #44. Esta fase NÃO reexecuta as verificações antigas: adiciona um contrato de acesso com uma única consulta, nenhum segredo JSON e respostas sem conteúdo.

## Novidade desta fase
- Um script de somente leitura é limitado a repositorio, branch, workflow manual, projeto QA literal, conta de serviço leitora e provedor WIF previamente configurado.
- A única operação de rede permitida pelo script é GET do documento fictício posts/qa_post_1, com resposta limitada a 8192 bytes e 6,5 segundos, sem redirecionamentos.
- Um workflow separado só aceita acionamento manual com confirmação e ambiente guardian-qa; NÃO é acionado por push, PR ou cron e não faz deploy.
- O teste remoto NÃO foi executado: um workflow_dispatch novo normalmente exige existência do arquivo no branch padrão, e WIF pode estar preso à branch anterior. NÃO mesclar apenas para habilitar a execução.
- Testes locais simulam token, documento, IAM 403 e erros; eles não comprovam privilégio mínimo real nem operabilidade do Worker.

## Restrições
- Não ativar IAM adicional, billing, Blaze, Cloud Run, chaves permanentes, Firebase de produção, Worker de produção, moderação ou retenção automática.
- Mesmo com OAuth temporário, chamadas de servidor Firestore usam IAM e ignoram Security Rules de cliente. Limite por caminho neste script não restringe o privilégio da identidade fora do script.
- Prova de leitura remota autorizada ainda pendente. HTTP 404 não equivale a sucesso positivo.
- Cron no Cloudflare não recebe identidade OIDC do GitHub por existir um workflow.
- Respeitar R$ 0 e não alterar backups.
