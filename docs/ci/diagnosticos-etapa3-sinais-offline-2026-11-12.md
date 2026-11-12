# Etapa 3 — Classificação conservadora de sinais de falha (QA isolado)

**Data:** 12/11/2026. **Escopo:** somente análise offline, sem consulta de APIs, sem disparar workflow, sem deploy, sem credenciais.

## Por que esta fase existe

O inventário da etapa 1 encontrou classes distintas de erro: referências Kotlin não resolvidas, rejeição de contratos de CI, divergências de fixtures das Rules QA, falhas de emulador e falhas cujo log mostra apenas exit code 1. O simples estado `failure` de um check não prova a causa. A identificação de sinais agora exige uma **conclusão do job informada como `failure` ou `timed_out`**; sem essa confirmação, não há classificação de incidente. O objetivo desta fase é diminuir o esforço de triagem, preservando incerteza.

## Implementação candidata

- `scripts/ci_failure_classifier.py` aceita **apenas um arquivo local de log** fornecido explicitamente com `--log-file`, SHA exato, IDs de run e job e destinos dos relatórios.
- Saídas: JSON e Markdown contendo categoria, regra reconhecida, números de linhas e descrição fixa do sinal. **Nunca copia linhas do log bruto** (inclusive tokens, emails, nomes de usuário ou caminhos locais).
- Indicadores compostos devem aparecer dentro de uma janela de **15 linhas**; erros genéricos usam janela conservadora de até 250 linhas. Marcadores distantes não são unidos para inventar um diagnóstico.
- Logs marcados como `success`, `cancelled`, `skipped` ou `unknown` não geram sinais de falha.
- Quando mais de um sinal é encontrado, classifica como `multiple_signals_review_needed`, sem eleger causa raiz. Quando só existe erro genérico (ou não existe padrão), admite inconclusão.
- Entrada limitada a 2 MB e 40 mil linhas; sem acesso à rede, sem execução de código do log e sem tentativa de correção automática.
- Testes sintéticos dos casos históricos são executados pelo check Firestore já existente; nenhuma automação adicional e nenhuma permissão nova.

## Exemplo de operação em ambiente offline

```bash
python3 -m scripts.ci_failure_classifier \
  --log-file exemplo-falha.txt \
  --sha aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --run-id 12345 --job-id 67890 \
  --job-conclusion failure \
  --json resultado.json --markdown resultado.md
```

**Importante:** o classificador NÃO baixa os logs. Um operador deve fornecer uma amostra de log legítima, revisada, por um canal apropriado. Não inserir segredos no arquivo de entrada. Os artefatos produzidos são informativos e não constituem verificação de segurança ou autorização de merge.

## Critérios de aceite

1. Confirmar os testes no GitHub Actions e CodeQL nas quatro linguagens.
2. Validar ausência de vazamentos de dados dos logs nos resultados de teste.
3. Não alterar produção, `main`, backups, signing, Rules, Firebase ou Cloudflare.
4. Registrar classificações indeterminadas e múltiplos sinais sem especular.
5. Antes de ativar qualquer automação por logs reais, rever o modelo de privacidade e o controle de acesso aos artefatos.

Este é o **primeiro incremento** da etapa 3, ainda não um diagnosticador de causa raiz completo. O relatório de etapa 2 está em PR separada (#257); integração entre as duas etapas deve ser revisada posteriormente, sem merge automático.

## Inspeção de logs históricos — amostra exploratória

A lógica de correlação por proximidade e estado foi conferida em memória, sem salvar logs brutos nem incluir seu conteúdo neste repositório. Seleção dirigida de **seis jobs com falha e quatro jobs aprovados** de execuções do Átrio Católico. Não é uma amostra estatística aleatória, e **não comprova acurácia generalizável nem causa raiz**.

| Job | Evidência de referência | Sinal esperado e observado |
| --- | --- | --- |
| Kotlin, falha de compilação | [run 43123771472](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43123771472) | `kotlin_unresolved_reference` |
| Contrato Gradle/CI | [run 43073256100](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43073256100) | `ci_contract_mismatch` |
| Rules QA | [run 43127062941](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43127062941) | `qa_rules_baseline_assertion` |
| Mocks Firebase | [run 43073244274](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43073244274) | `qa_mock_sha_assertion` |
| Emulador Android | [run 43073256093](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43073256093) | Dois sinais distintos: ADB offline e timeout Compose |
| Guarda de exclusões | [run 43073243766](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43073243766) | Sem sinais; permanece **inconclusivo** |
| Quatro jobs aprovados | Android e Firestore, entre 11 e 12/11/2026 | Nenhum incidente sinalizado quando o job é informado como `success` |

O resultado descritivo foi: **5/6 falhas com ao menos um sinal específico; 1/6 sem evidências suficientes; 0/4 jobs aprovados classificados como falhas**. A correspondência foi checada por inspeção programática das regras e dos logs reais; a execução do módulo em CI usa fixtures sintéticas correspondentes. Isso **não equivale** a validar o módulo inteiro diretamente contra os dez logs reais, nem autoriza extrapolar taxa de precisão para o projeto.

## Bloqueios antes de uso operacional

1. Reconfirmar CodeQL, compilação Android e os testes de regressão no último SHA da PR.
2. Definir política de acesso a logs, retenção e redigimento antes de qualquer ingestão automática.
3. Avaliar falsos positivos e falsos negativos em uma amostra mais ampla, com casos não usados na elaboração das regras.
4. Verificar manualmente qual job e qual SHA originaram o arquivo; os parâmetros fornecidos pelo operador não são validados remotamente.
