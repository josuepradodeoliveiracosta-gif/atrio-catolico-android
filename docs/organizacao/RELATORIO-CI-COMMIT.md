# Relatório consolidado por commit — somente leitura

Melhoria 4/5 da qualidade de desenvolvimento. PR draft e separada.

O workflow consulta os checks registrados na GitHub API para o SHA
exato da PR, ou do workflow que acabou de concluir. O relatório registra
estados dos checks e os cinco requisitos conhecidos da ruleset de main.
Ausente, pendente, ignorado e cancelado nunca se tornam aprovados.

O Step Summary e um artefato JSON/Markdown guardam a evidência de cada
execução. O gatilho de PR produz um retrato inicial que pode ser parcial.
Após integração autorizada, eventos workflow_run geram novos retratos
quando terminam fluxos relevantes. Nada é escrito em PRs nem em main.

Permissões: contents: read, checks: read e actions: read. Token GitHub
somente para GET de checks, sem Firebase, Cloudflare, assinatura ou deploy.
Testes Python usam mocks e executam antes da consulta remota.

Limite de seis páginas de 100 checks impede truncamento silencioso.
Falha de consulta falha o job em vez de inventar resultados.
O relatório não substitui revisão humana nem libera merge.
