# Organização de Pull Requests focadas

**Proposta em PR separada da #193**, sem alterar regras de produção,
checks obrigatórios, assinatura, main ou backups.

A template de Pull Request orienta a delimitação do objetivo, testes,
riscos e aprovação humana. Um workflow adicional faz uma auditoria
exclusivamente informativa do diff acumulado usando SHAs fixos.

Em cada PR para main, uma suíte Python offline classifica os arquivos por
Android, Firebase, Cloudflare, CI, ferramentas e documentação. O relatório
é publicado em GitHub Step Summary, sem comentários automáticos, tokens
adicionais, alterações de labels ou acesso externo.

Quando o escopo passa de 30 arquivos ou quatro áreas, o relatório recomenda
avaliar PRs menores, mas não reprova PRs históricas como a #193.
Áreas sensíveis recebem um lembrete de revisão e aprovação específica.

A contagem de arquivos não mede qualidade nem substitui revisão humana.
Não interfere nos cinco required checks atuais ou no trabalho de QA.
Após a integração autorizada, o template aparecerá para novas PRs.
