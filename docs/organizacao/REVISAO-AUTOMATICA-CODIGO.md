# Revisão automática de código — CodeQL

**Estado:** PR pequena de infraestrutura em rascunho. Nenhum merge ou deploy.

Esta PR, separada da #193, contém somente um workflow de análise estática,
testes de contrato e documentação. Não modifica Android, regras Firestore,
Cloudflare Workers, assinatura oficial, main ou backups.

## Cobertura

- Java/Kotlin: compilação Android Debug rastreada pelo CodeQL.
- JavaScript/TypeScript: scripts e Workers.
- Python: automações e ferramentas.
- GitHub Actions: configurações CI e segurança dos próprios workflows.

As consultas security-and-quality incluem segurança, qualidade e confiabilidade.
As quatro análises são independentes e não cancelam execuções anteriores.

## Execução

Acionamento em toda PR destinada à main, no push à main, semanalmente
na branch padrão e por workflow_dispatch. Os eventos de main e schedule
só vigorarão após uma integração expressamente autorizada.

Somente o job de análise usa security-events: write para registrar resultados
no Code Scanning. Não recebe credenciais Firebase, Cloudflare nem de assinatura.
O build Kotlin usa apenas :app:assembleDebug e não publica APK.

CodeQL não substitui revisão humana, não comprova ausência de falhas e
não altera os cinco checks obrigatórios ou as regras de proteção.
Esta melhoria só estará validada quando os jobs reais da PR passarem.
Pode ser necessário conferir as configurações Code Scanning do repositório.

Referências oficiais:
https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configuring-advanced-setup-for-code-scanning
https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options
https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/codeql-for-compiled-languages

## Correcao da revisao de seguranca no preparo da integracao

O GitHub Advanced Security sinalizou duas actions de terceiros sem SHA imutavel: `android-actions/setup-android` e `gradle/actions/setup-gradle`. Ambas passaram a usar commit SHA completo, respectivamente `be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd` (tag `v4`) e `ed408507eac070d1f99cc633dbcf757c94c7933a` (tag `v4.4.3`, resolvida a partir de `v4`). Esta correção atende ao achado sem enfraquecer a análise; manter as conversas abertas até que os novos checks confirmem a versão corrigida.
