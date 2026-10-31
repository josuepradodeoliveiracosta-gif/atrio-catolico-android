# Guardião V2 — prova de identidade temporária, exclusiva QA

OIDC/WIF de GitHub Actions já foi usado para leitura QA na PR #44. Esta fase NÃO reexecuta as verificações antigas: adiciona um contrato de acesso com uma única consulta, nenhum segredo JSON e respostas sem conteúdo.

## Novidade desta fase
- Um script de somente leitura é limitado a repositorio, branch, workflow manual, projeto QA literal, conta de serviço leitora e provedor WIF previamente configurado.
- A única operação de rede permitida pelo script é GET do documento fictício posts/qa_post_1, com resposta limitada a 8192 bytes e 6,5 segundos, sem redirecionamentos.
- Um workflow separado só aceita acionamento manual com confirmação e ambiente guardian-qa; NÃO é acionado por push, PR ou cron e não faz deploy.
- O arquivo de workflow_dispatch já existe na `main` após a PR #46, mas a sonda **só** aceita a branch isolada `feature/guardiao-v2-wif-prova-qa-20261030`, com confirmação manual. Não executamos a sonda remota. A política WIF pode estar presa a outra branch e negar o acesso; neste caso, o resultado correto é **NO-GO**, sem ampliar IAM automaticamente.
- Testes locais simulam token, documento, IAM 403 e erros; eles não comprovam privilégio mínimo real nem operabilidade do Worker.

## Restrições
- Não ativar IAM adicional, billing, Blaze, Cloud Run, chaves permanentes, Firebase de produção, Worker de produção, moderação ou retenção automática.
- Mesmo com OAuth temporário, chamadas de servidor Firestore usam IAM e ignoram Security Rules de cliente. Limite por caminho neste script não restringe o privilégio da identidade fora do script.
- Prova de leitura remota autorizada ainda pendente. **HTTP 404, 401, 403, corpo inválido ou erro de rede fazem o workflow falhar**; não há sucesso sem GET 200 da fixture esperada.
- Cron no Cloudflare não recebe identidade OIDC do GitHub por existir um workflow.
- Respeitar R$ 0 e não alterar backups.

## Ajuste de segurança pós-merge
- O fluxo não pode terminar verde quando o operador não confirma a execução, seleciona `main` ou escolhe outro ramo: a etapa inicial falha antes da emissão OIDC, em vez de marcar o job apenas como ignorado.
- Branch QA fixada em `feature/guardiao-v2-wif-prova-qa-20261030` no workflow, no código da sonda e nos testes; a branch experimental antiga não é mais aceita pela atualização.
- **Não executar teste manual sem validar que o ambiente GitHub `guardian-qa` possui o provedor WIF e a conta de leitura esperados, sem conceder novas permissões.** Se faltar configuração, interromper e registrar o bloqueio.
- A credencial curta de GitHub Actions **não fornece acesso permanente ao Worker Cloudflare**. Não confundir a prova de leitura WIF com a autorização para varredura 24h.
