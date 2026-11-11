# CodeQL: remover dependência serial sem reduzir cobertura (etapa 2/5)

Data da proposta: 2026-11-11. Escopo: apenas configuração CI, testes offline e documentação.

## Gargalo observado

O workflow CodeQL analisava quatro linguagens em uma matriz paralela (`max-parallel: 4`), mas a matriz dependia de um job preliminar `contract` com `needs: contract`. A dependência impede que qualquer job da matriz seja disponibilizado ao agendador até o término do contrato, mesmo quando os runners estão livres. A remoção da dependência pode economizar apenas alguns segundos em condições normais; **não deve ser confundida com uma solução para longas filas de runners**.

- [PR CodeQL 43034658776](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43034658776): total 203s, job Kotlin começou aproximadamente 10s após o início do workflow e executou por 192s.
- [PR CodeQL 42949257642](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42949257642): total 688s; o job Kotlin iniciou 482s depois e executou por 206s. A fila/dependência foi dominante.
- [CodeQL main 43037350618](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43037350618): 250s, Kotlin 241s, incluindo compilação Android 117s e análise CodeQL 66s. Não há ganho comprovado por cache especulativo.

## Mudança proposta

1. `codeql-review.yml`: remover exclusivamente `needs: contract` da matriz, preservando o job `Validar contrato seguro da revisão`. O contrato e os quatro jobs CodeQL agora são agendados independentemente.
2. `selos-ci.yml`: executar `scripts.test_codeql_review_workflow` no **check obrigatório Regras de seguranca Firestore**. Se o contrato de CodeQL falhar, a PR não poderá avançar mesmo que outros jobs de CodeQL estejam aprovados.
3. `scripts/test_codeql_review_workflow.py`: exigir cobertura das quatro linguagens, matriz paralela, permissões mínimas, análise Kotlin manual, configuração de proteção e contrato CodeQL incorporado ao check obrigatório.

## O que não muda

- CodeQL JS/TS, Python, Actions e Java/Kotlin continuam executando, com `security-and-quality`, `fail-fast: false` e `max-parallel: 4`.
- A compilação `gradle :app:assembleDebug` para Kotlin, o SDK 36, Java 17, Gradle 8.13 e os caches atuais permanecem idênticos.
- Todos os cinco checks obrigatórios de proteção da `main` continuam intactos.
- Sem assinatura, distribuição de APK, Firebase, Cloudflare, OTA, alteração de rulesets, permissões adicionais ou secrets.

## Critérios de aceite

- Contratos offline e cinco checks obrigatórios aprovados na PR.
- Quatro checks CodeQL e o contrato CodeQL aprovados na PR, com jobs iniciando independentemente.
- Pelo menos dez execuções comparáveis futuras para medir diferença de mediana e P90; considerar fila e picos de Dependabot, não atribuir ganhos sem controle.
- Se a mudança causar falhas, aumento de custo ou piora consistente, restaurar a dependência serial.

Proposta sem autorização para merge ou publicação. A meta de nota 9,5 não se considera atingida por esta alteração isolada.
