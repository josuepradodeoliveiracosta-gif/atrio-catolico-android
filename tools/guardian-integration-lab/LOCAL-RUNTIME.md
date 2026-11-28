# Integração executável local do Guardião — sem APK

Execute `bash tools/guardian-integration-lab/run-local-qa.sh` a partir do checkout, com Node 22.13+, Java e kotlinc já instalados. O módulo `node:sqlite` é experimental no Node 22. Nenhuma dependência é baixada. O script não compila APK, não executa Gradle, não chama provedores nem workflows.

`local-qa-runtime.mjs` conecta o classificador oficial do Worker aos gates de autorização e financeiro, à correlação de eventos e classificação de riscos, e ao fluxo de fila e contestação. SQLite em memória fornece transações reais dentro de um processo: admissão/cobrança sintética, recibo idempotente, revisão do documento, caso, auditoria e aviso são registrados juntos. A contestação tem atribuição separada por coordenador de fixture, revisão independente, CAS e auditoria/aviso atômicos. A fila gera a mesma projeção validada pelo Kotlin. Não há aplicação automática de punições.

Somente dados fictícios, escopo de triagem de fórum. A fila de moderação inclui fixtures de fórum, usuários e feed; nenhuma leitura remota. Histórico de infrações não é inventado. A base de orçamento é sintética e não sobrevive ao processo; não é uma reserva de cotas compartilhadas nem prova de planos ou identidade reais. A identidade do coordenador é apenas um papel de teste. Não importar este módulo no Worker implantado ou no aplicativo. Sem alterações nas Rules, IAM/WIF, workflows, Gradle ou ponto de entrada de produção.

Resultados locais: 408/408 JavaScript (377 anteriores e 31 novos), 44/44 modelo Kotlin, 15/15 ponte Kotlin com a saída do novo runtime e 18/18 modelo do painel QA. Total 485/485. Não é teste do checkout integral, Firebase Emulator, Compose ou APK. Os arquivos de referência são cópias locais conferidas por blob Git.

NO-GO para merge/deploy/ativação operacional: faltam IAM/WIF segregado, fonte confiável de métricas, reserva atômica global, adaptadores reais de persistência e regras com testes de transação, política de retenção e homologação. Não ampliar a autoridade do motor oficial para simular conclusão desses requisitos.
