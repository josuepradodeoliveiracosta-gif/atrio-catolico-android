# Átrio Católico — auditoria da coleta de evidências do diagnóstico

**Data:** 13/11/2026. **Etapa do novo plano:** 2/5 — auditar a capacidade existente antes de implementar o novo contrato de relatório.  
**Fonte observada:** árvore da \`main\` no commit \`8b82edf08067a7e1519c3c9d006f0f23bcc933cb\`; leitura do código e da configuração dos workflows, sem execução de reparos.  
**Decisão aplicável:** [diretriz de coleta de evidências](diagnosticos-diretriz-coleta-evidencias-2026-11-13.md) — documento novo na PR #278, ainda **não** integrado à main.

## 1. Conclusão executiva

**É possível reaproveitar a base já construída.** Há componentes operacionais para consultar checks, consolidar um snapshot, verificar a proveniência de jobs, analisar uma quantidade limitada de logs em memória, classificar sinais por regras fixas e gerar artefatos de QA. O objetivo novo exige principalmente **integrar as informações num dossiê por ocorrência, explicitar lacunas e medir completude, latência, volume e esforço de coleta**.

**Não confundir:** existência de scripts e testes, checks verdes, capacidade de ler logs, cobertura de sinais ou sucesso de uma suíte forense com demonstração de que o novo coletor já reúne todas as informações necessárias para solucionar os incidentes. Esta auditoria é de **código e contratos**, não um benchmark de desempenho ou homologação operacional.

## 2. Inventário verificado na main

| Componente existente | Fato constatado no código | Como reaproveitar | Limitação relevante para a nova meta |
| --- | --- | --- | --- |
| \`scripts/ci_quality_report.py\` | Consulta checks de um SHA específico, até seis páginas de 100; registra estado, conclusão, URL de Actions sanitizada, duração observada e checks obrigatórios | Fonte primária para identidade do commit, visão do CI e métricas de duração de checks | A duração do **check** não mede o tempo nem o custo de **coleta**; não descreve uma ocorrência com todas as suas fontes |
| \`scripts/ci_diagnostic_snapshot.py\` | Consolida o JSON anterior, distingue SHA histórico/HEAD informado, ordena checks não aprovados e extrai uma fila de até 12 IDs de jobs com falha | Índice inicial das ocorrências com links canonizados | IDs são **candidatos não verificados**; campos de estágio e grau de completude ainda não compõem um dossiê unificado |
| \`scripts/ci_log_identity_verifier.py\` | Verifica repositório, run, job, SHA, conclusão e tentativa via endpoints fixos, respostas até 64 KiB, e produz vereditos fechados | Camada de confiança obrigatória antes de analisar logs | Verificar SHA histórico não comprova HEAD atual da PR; falta correlacionar tentativas/fontes no relatório final |
| \`scripts/ci_log_safe_analysis.py\` | Processa **no máximo 3 jobs verificados**, com **2 MB de log por job**; não publica logs brutos; só exporta classificação e IDs fixos de sinais | Núcleo de triagem segura e política inicial de limites | Cobertura fica limitada a até 3 logs por relatório; a saída agregada não preserva todos os metadados locais de evidência, como números de linha do classificador |
| \`scripts/ci_failure_classifier.py\` | Regras determinísticas para falhas/timeout; limita a 40.000 linhas e 2 MB; pode retornar IDs de sinais, força do sinal, linhas de evidência e estado inconclusivo | Detecção de indicadores observáveis sem afirmar causa definitiva | Conjunto finito de padrões; \`ci_log_safe_analysis.py\` repassa só \`signal_ids\` e \`classification\`, não a força/linhas da análise local |
| \`.github/workflows/ci-quality-report.yml\` | Acionado após CodeQL (\`workflow_run\`) ou manualmente; gera \`ci-report.json\`, \`ci-diagnostics.json\`, \`ci-job-evidence.json\`, \`ci-log-signals.json\` e \`ci-report.md\`; artefato retido por 14 dias | Pipeline existente, com permissões de leitura; evitar duplicá-lo sem necessidade | Snapshot pode ocorrer com outros checks pendentes; a saída é dividida em arquivos e não há métrica explícita de completude de coleta por caso |
| \`scripts/ci_diagnostic_replay.py\`, \`scripts/ci_diagnostic_evaluation.py\`, \`scripts/ci_diagnostic_kpi_baseline.py\` | Replay sintético, avaliação do holdout e métricas sem fingir precisão causal | Testes de regressão e linha de base dos sinais | Holdout de 16 jobs não é uma prova representativa de completude/eficiência do novo pacote de evidências |
| \`scripts/ci_diagnostic_review_queue.py\`, \`scripts/ci_diagnostic_historic_identity.py\` | Organizam tarefas e verificam identidades históricas, sem criar uma atestação humana | Referências auditáveis para casos históricos | A fila existe para revisão de causa, mas agora poderá alimentar revisões de **lacunas de evidências** |
| \`scripts/ci_autofix_*\` e \`.github/workflows/autofix-qa-approved-draft.yml\` | Subsistema separado de política/planejamento e possíveis PRs draft sob condições próprias; o relator também calcula previews e planos sem reparar diretamente | Preservar os controles; depois isolar a apresentação do coletor em relação às propostas | A estratégia nova não autoriza desativar recursos existentes; não contabilizar propostas como informações sobre a causa ou reparos |

### Políticas de segurança constatadas

- O verificador de identidade e os leitores de logs usam caminhos de API construídos localmente e negam redirecionamento de token; o leitor de logs só aceita destinos HTTPS previamente permitidos e **sem** encaminhar Authorization ao host temporário.
- O diagnóstico trabalha com IDs, rótulos e links normalizados; o log bruto é inspecionado em memória e **não entra no artefato**.
- Falta de credenciais/metadata, SHA divergente e limites excedidos não podem virar resultados falsamente positivos.
- Os arquivos de **planejamento** de correção presentes no pipeline não equivalem a mudanças aplicadas. Um workflow automático separado pode abrir PR draft sob condições estritas; **não desativado nem alterado por esta auditoria**.

## 3. Lacunas e riscos específicos do novo objetivo

| Prioridade | Lacuna observada | Consequência | Próxima implementação segura |
| --- | --- | --- | --- |
| **P0** | Ausência de **contrato unificado por ocorrência** com proveniência e valor ausente explícitos | O assistente precisa juntar manualmente múltiplos JSONs; é fácil misturar commits, jobs ou níveis de verificação | Definir estrutura versionada de dossiê, validada de ponta a ponta a partir dos artefatos existentes |
| **P0** | Não há **matriz de evidências esperadas × recebidas** no mesmo relatório por caso | Não se mede completude; relatório parcial pode parecer completo | Listar campos esperados, obtidos, indisponíveis, não aplicáveis e não verificados, com denominadores coerentes |
| **P0** | \`ci_log_safe_analysis.py\` descarta detalhes da evidência fornecidos por \`classify()\` (p.ex. linhas e força de sinais) | Triagem mostra o sinal mas exige nova leitura manual para localizar o ponto | Usar apenas números de linha e IDs previamente sanitizados e associados ao job verificado; nunca publicar trechos brutos |
| **P1** | Limites existentes (12 candidatos, **3 logs examinados**, 2 MB por log) sem estatística por relatório de elegíveis não examinados e motivo de seleção explícito | Lacunas podem ficar escondidas quando a fila é grande | Declarar elegíveis, selecionados, omitidos por limite, sem identidade, indisponíveis e duplicados; medir antes de ampliar limites |
| **P1** | Ausência de métricas específicas da **coleta** (número de GETs, tempo, bytes, latência por fonte, custo de reconsulta) | “Altamente eficiente” ainda não é mensurável | Instrumentar contadores locais sem dados sensíveis e comparar com baseline de mesma amostra |
| **P1** | Snapshot vinculado ao ciclo de CodeQL; os checks podem não estar todos concluídos | O dossiê pode ser apenas uma fotografia parcial do CI | Campo de atualidade/fase da coleta, distinguir \`pending\` de \`missing\` e indicar quando uma nova consulta agregaria informação |
| **P1** | Fluxo de relatórios compartilha execução com previews e planejamento \`ci_autofix_*\` | Maior custo de auditoria da saída e possível retrabalho em etapas sem relação com coleta | Isolar **contrato e artefato de coleta** do contrato de sugestões de reparo, reaproveitando os mesmos dados; mudanças de workflows só em PR própria |
| **P2** | Padrões de sinais não cobrem necessariamente todos os tipos de erro do app ou emuladores | Alguns casos permanecem inconclusivos | Expandir cobertura baseada em exemplos públicos/sintéticos e em evidências autorizadas, sem fingir causa raiz |
| **P2** | Revisão histórica foi orientada a causas e meta de autocorreção | Não avalia se o relatório poupa tempo ao assistente | Testes cegos de suficiência de evidência e medidas de perguntas adicionais necessárias para iniciar investigação |

**Não foi comprovado** nesta auditoria que há vazamento, uso excessivo de API, regressão de CI, falha das regras de segurança, indisponibilidade de coleta ou consumo anormal de runner. As lacunas acima são **ausências no contrato revisado ou riscos de cobertura**, não incidentes produtivos.

## 4. Linha de base disponível e limites da medição

A linha de base histórica em \`docs/ci/diagnosticos-etapa10-indicadores-baseline-2026-11-13.md\` registra **13 jobs com falha e 3 controles**, com **3/13 sinais específicos**, **3/13 apenas genéricos**, **7/13 inconclusivos** e **0/13 revisões causais independentes**. Isso **não mede** eficiência nem completude de coleta. A amostra não foi selecionada como amostra representativa cega para todas as falhas.

A implementação contém limites estáticos de processamento (**até 600 checks em seis páginas; 12 candidatos a logs; 3 logs analisados; 2 MB por log; até 40.000 linhas no classificador**), mas **não foi medido** neste levantamento quanto tempo uma execução real consome, quantas chamadas faz ou o quanto desses limites é necessário. Não estabelecer metas numéricas sem medir baseline e ambiente comparável.

## 5. Próximas etapas com critérios objetivos

### Etapa 3 — Contrato de dossiê

Definir e implementar um **formato JSON versionado**, orientado a uma ocorrência, com pelo menos:

- \`identity\`: repositório, SHA, workflow, run, job, tentativa, etapa e estado de verificação;
- \`sources\`: tipo da fonte, estado de obtenção (\`verified\`, \`unavailable\`, \`not_checked\`, \`not_applicable\`), referência segura, motivo estático de ausência;
- \`observations\`: IDs de sinais, gravidade **somente se comprovada**, linhas numéricas com rastreabilidade e descrição previamente autorizada;
- \`coverage\`: esperados, coletados, ausentes, não aplicáveis e recusados, com denominador e critério explícitos;
- \`collection_metrics\`: números de chamadas, bytes efetivamente lidos, duração medida, contagens de cache/duplicatas sem nenhum payload sensível;
- \`status\`: \`complete\`, \`partial\` ou \`unavailable\`, **sem deduzir causa raiz**;
- \`suggested_followups\`: perguntas técnicas e testes seguros com origem identificável, sem executar ações.

**Aceite:** rejeitar IDs/SHA inconsistentes e campos extras perigosos; estados ausentes não equivalem a \`false\`; entradas idênticas produzem saída determinística; não publicar logs brutos, credenciais, texto arbitrário ou parâmetros de URL; nenhum dado extra deve ser inventado.

### Etapa 4 — Eficiência da coleta

Usar os mesmos jobs sintéticos e históricos para comparar: campos úteis disponíveis, fontes ausentes identificadas, número de GETs, bytes, duração e reconsultas. **Só depois** decidir alterar limites de 3 logs/2 MB ou prioridades. Preservar autenticação, quotas e falha conservadora.

### Etapa 5 — Homologação do novo objetivo

Exigir prova por testes e artefatos de que um erro do Android, um caso Firestore e um erro genérico produzem dossiês completos **ou explicitamente parciais**, com proveniência suficiente para o assistente investigar, sem exigir causa comprovada nem correção automática. Testar falha de rede, log ausente, SHA incorreto e conteúdo hostil, e conferir checks do commit exato. O assistente deve conseguir localizar **o que ocorreu e quais dados faltam** sem que o coletor proponha agir na produção.

## 6. Limites e estado de conclusão

- **Etapa 2 auditada no código:** inventário, limitações, prioridades e contrato-alvo registrados nesta PR documental.
- **Não executado:** benchmark de desempenho, alteração de scripts/workflows, validação de novo contrato, provas end-to-end, desligamento de automação, merge ou deploy.
- A diretriz e esta auditoria estão somente na PR #278 (draft), não na \`main\`. O sistema atual não foi substituído pela proposta.

**Princípio central:** o diagnóstico deve entregar um **dossiê confiável de evidências verificáveis**, não um palpite automático de causa ou um reparo executado sem autorização.
