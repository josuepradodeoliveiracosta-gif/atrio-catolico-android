# Átrio Guardião — laboratório offline consolidado

Os 22 arquivos de código, testes e script do laboratório dos marcos 03–12 foram incorporados com SHA de blob conferido contra o pacote local. Uso exclusivo de dados sintéticos; não importar em Worker, rotas remotas ou Android operacional. Nenhuma autorização real, persistência, reserva de cota ou ação disciplinar é concedida. O painel local previamente integrado permanece somente leitura. A documentação histórica do pacote ZIP não é duplicada aqui.

## Reproduzir sem APK

A partir da raiz da branch, com Node 22, Java e kotlinc já instalados:

```sh
bash tools/guardian-integration-lab/run-local-qa.sh
TMP=$(mktemp -d)
kotlinc app/src/main/java/br/com/atriocatolico/GuardianReportPageSummary.kt tools/guardian-integration-lab/GuardianReportPageSummaryTest.kt -include-runtime -d "$TMP/page.jar" && java -jar "$TMP/page.jar"
rm -rf "$TMP"
```

Reexecutados no pacote local: 351/351 testes Node, 44/44 modelo Kotlin, 15/15 ponte JavaScript–Kotlin e 18/18 modelo de adaptação do painel, total 428/428. A identidade dos blobs garante correspondência entre arquivos versionados e arquivos testados; não é uma execução de CI no checkout integral. Compose não compilado. Não executar Gradle, compilar APK, implantar ou ativar serviços pagos. PR em rascunho. Nenhuma alteração em workflows, Rules, IAM ou configuração de produção.

## Bloqueios de integração funcional e release

- Origem autenticada das métricas compartilhadas e reserva atômica de cotas; sem recursos pagos.
- Separação efetiva IAM/WIF e revogação de autoridade direta indevida.
- Adaptação autenticada dos eventos sem chat privado; calibração dos sinais.
- Persistência transacional, retenção, Rules e autorização dos recursos com revisão independente.
- Homologação real quando expressamente autorizada; nível crítico depende de protocolo humano separado.

Adoção de princípios dos projetos OPA, Coop, Osprey e Ozone, sem importar código de terceiros. Não confundir código versionado no laboratório com integração funcional em produção. Reversão: descartar branch/PR ou reverter commits após revisão, sem alterar serviços.
