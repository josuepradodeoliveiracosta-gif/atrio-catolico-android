# Orientacao automatica e conservadora para diagnosticos do CI

Incremento de QA em 12/11/2026, PR #259 em rascunho.

O relatorio consolidado ja executa automaticamente quando o CodeQL termina. O modulo scripts/ci_diagnostic_snapshot.py agora orienta o proximo procedimento seguro por check, usando somente estados e nomes presentes no JSON de checks existente.

A triagem distingue falhas concretas, estados pendentes, resultados ignorados e checks ausentes. A ausencia de um check pode depender do evento e nao comprova falha. Cada recomendacao tem ID fixo e texto controlado; nomes de checks recebidos sao escapados no Markdown.

O mesmo artefato ci-diagnostics.json passa a incluir safe_next_step por verificacao, required_review e auto_triage com contagens, sem outros acessos a rede, log bruto, credenciais ou novos artefatos.

Limites: nao determina causa raiz, nao executa correcoes, nao tenta reexecutar jobs, nao abre PRs nem altera GitHub, Firebase, Cloudflare, rulesets, backups ou APKs. Relatorios automaticos nao autorizam merge e producao. A meta de 90 por cento de precisao causal continua sem comprovacao.

Validacao: novos testes offline no gate existente e no workflow de relatorio, sem alterar gatilhos, jobs ou permissoes. A automacao so passa a operar no workflow padrao apos revisao e aprovacao humana da PR. Nenhum merge automatico.
