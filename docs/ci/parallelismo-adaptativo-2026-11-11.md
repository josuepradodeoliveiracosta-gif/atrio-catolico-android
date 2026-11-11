# Paralelismo adaptativo do GitHub Actions — proposta auditável

Data: 2026-11-11. Alterações propostas **somente em PR**, sem publicação, merge automático, alteração de regras, segredos, dados ou backups.

## Evidências e limites de ganho

- `selos-ci.yml`: jobs obrigatórios Android e Firestore **já independentes**. Amostra de PR (run [42947662023](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42947662023)): Android ~140s, Firestore ~40s.
- CodeQL: matriz de quatro linguagens com `max-parallel: 4`, execução Java/Kotlin na casa de minutos (run [42949024556](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42949024556)). Não criar dependências extras e não remover compilação Kotlin.
- Os testes Firestore executam dois lotes de emulador dentro de um job de ~40s. Reparti-los em runners separados exigiria preparação npm/Java/emulador duplicada e seria provavelmente **mais lento**; essa divisão não foi feita.
- `worker-bundle-dry-run-ci.yml` tinha dois empacotamentos Wrangler incondicionais em sequência. A execução agora escolhe só os afetados; se ambos mudarem, continua executando ambos. Evita divisão em dois runners para jobs curtos.
- Os tempos de jobs são observações, não uma meta de ocupar 20 runners ou prova de ganho causal.

## Alterações propostas

1. **Seleção opcional fail-closed dos Workers:** `scripts/ci_worker_scope.py` valida base/head Git, exige base comum não ambígua, diff NUL, limites de tamanho e inclui exclusões/renomes. Apenas `cloudflare/avatar-worker/**` aciona Avatar; apenas `cloudflare/push-worker/**` aciona Push. Mudanças compartilhadas, arquivos CI relacionados e qualquer erro no diff acionam **ambos**. `workflow_dispatch` sempre aciona ambos. O seletor não usa token, secret nem GitHub API.
2. **Paralelismo sem custo inútil:** mantém os jobs Android/Firestore independentes e matriz CodeQL; executa somente o bundle opcional pertinente em vez de adicionar runners.
3. **Filas:** grupos de PR compartilham número da PR e podem descartar checks *antigos da mesma PR*. `run_id` isola jobs manuais, push e acionamentos não PR para não perder execuções pendentes. `build-apk` usa grupo próprio por execução e mantém `cancel-in-progress: false` e os gates de assinatura/OTA sem mudanças. Quando acionamentos manuais simultâneos ocorrerem, serão independentes; nenhum deles publica automaticamente.
4. **Cache:** preserva configuração comprovada de Gradle/npm; evita introduzir cache global compartilhado para `npx wrangler@4`, que não possui lockfile e pode prejudicar isolamento/reprodutibilidade. Reavaliar depois de benchmark controlado.
5. **Métricas:** o relatório de CI usa timestamps **já presentes** nos check-runs do SHA, sem chamadas adicionais ou permissões de escrita. Soma as durações observadas dos checks do GitHub Actions e lista os cinco mais longos. Não equivale a custo cobrável nem mede tempo de fila. Ausência de timestamps não produz durações fictícias.
6. **Validação:** contratos offline em `scripts/test_ci_worker_scope.py`, `scripts/test_ci_quality_report.py` e `scripts/test_ci_optimization_contract.py` passam pelo check obrigatório `Regras de seguranca Firestore`. Workflow opcional dos Workers executa seus testes próprios. É proibido aprovar a PR com checks obrigatórios faltando, cancelados ou sem sucesso.

## Critérios para decisão

- Comparar um PR alterando **só Avatar** e outro alterando **só Push**: apenas o bundle correspondente deve executar; mudanças compartilhadas ou classificações inválidas executam ambos.
- Verificar eventos manuais sem cancelamento de execução pendente; checks de PR obsoletos só substituem suas próprias execuções.
- Confirmar os **cinco checks obrigatórios da main** completos e os quatro jobs CodeQL sem regressão.
- Confirmar que nenhum comando `wrangler deploy` aparece sem `--dry-run` no workflow de empacotamento e nenhuma variável/secreto de deploy é acessada.
- Comparar mais de um run antes/depois, separando duração, runners-minuto e filas; não prometer ganho percentual ou nota 9,5 antecipadamente.

Proibido: alterar backup ou produção, publicar APK/OTA, relaxar ruleset, introduzir `pull_request_target` para build ou confiar em um classificador com diff inválido.
