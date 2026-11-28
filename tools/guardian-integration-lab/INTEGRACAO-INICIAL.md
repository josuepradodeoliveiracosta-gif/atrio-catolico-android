# Guardião — integração inicial sem APK

Branch isolada, sem merge nem deploy. Painel somente leitura do fórum, restrito ao piloto QA Geral local, sessão atual, administrador aprovado e snapshot fresco. Os filtros afetam os indicadores da página, não a fila original. Não altera Firestore Rules, Worker, Gradle ou workflows; não cria consultas nem privilégios.

Teste de modelo (requer Kotlin/JVM e Java locais):
```sh
kotlinc app/src/main/java/br/com/atriocatolico/GuardianReportPageSummary.kt tools/guardian-integration-lab/GuardianReportPageSummaryTest.kt -include-runtime -d /tmp/guardian-page-test.jar
java -jar /tmp/guardian-page-test.jar
```

18/18 testes do modelo passaram offline no pacote de referência. Compose não compilado. O laboratório JavaScript cumulativo (351 testes locais aprovados) permanece no pacote externo, ainda não enviado nesta primeira integração. Não é autorização IAM/WIF, nem homologação de Rules, cotas, transações, recursos ou produção. Adoção por princípios arquiteturais, sem código de terceiros importado. Reverter este commit remove a adaptação; não alterar a main. 
