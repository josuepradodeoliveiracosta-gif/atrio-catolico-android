# Diagnósticos — etapa 2 (consolidação segura)

Data: 12/11/2026. Proposta **somente de QA**, em branch separada, para a revisão humana.

## Escopo

Aproveitar o script existente scripts/ci_quality_report.py e seu workflow ci-quality-report.yml, sem criar workflows, triggers, permissões ou chamadas adicionais à API. O novo scripts/ci_diagnostic_snapshot.py consome somente o JSON gerado pelo primeiro script, anexa uma seção de diagnóstico ao Markdown existente e cria o artefato complementar ci-diagnostics.json.

O resumo discrimina verificações obrigatórias ausentes, pendentes e não aprovadas; preserva os checks não aprovados, incluindo cancelados e pulados, com links verificados para o próprio repositório. O Markdown exibe até 20 entradas e avisa quando há mais; o JSON preserva todas. Não tenta identificar causa raiz, não oculta falhas históricas e não indica se o SHA ainda é o HEAD sem comparação explícita com um SHA confiável.

O objetivo é melhorar a leitura dos resultados já existentes, não alterar regras de merge, compilar mais vezes ou habilitar deploy.

## Testes

- python3 -m unittest scripts.test_ci_quality_report scripts.test_ci_diagnostic_snapshot -v
- python3 -m unittest scripts.test_ci_optimization_contract -v
- Validar uma execução real do workflow e seus artefatos, sem solicitar release ou publicação.

Os testes sintéticos cobrem: sucesso, ausência de checks obrigatórios, falhas, pendências, cancelamentos, SHA histórico, links externos proibidos, escape Markdown, consistência do relatório e geração idempotente.

## Limites e salvaguardas

- Nenhuma mudança em main, regras de proteção, backups, assinatura de APK, Firebase, Cloudflare ou ambiente de produção.
- Nenhum novo workflow nem disparo por PR; continua o único gatilho de workflow concluído do CodeQL, além de execução manual já existente.
- Tokens e logs brutos não são lidos pelo novo script; permissões somente de leitura são mantidas.
- Check aprovado não significa autorização de merge; revisão humana continua obrigatória.
- Esta etapa não implementa o classificador de causas, previsto para a etapa 3.

Critério de conclusão: testes offline e obrigatórios aprovados, revisão dos artefatos e ausência de regressões; manter a PR em draft até isso ocorrer.
