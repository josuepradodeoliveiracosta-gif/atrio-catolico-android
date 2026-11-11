# Modernização das GitHub Actions — segundo piloto, job Android

Data: 11/11/2026. **Escopo:** apenas o job `Compilar Android de testes` em `.github/workflows/selos-ci.yml`. Nenhuma ação de publicação, produção, OTA, Cloudflare, Firebase, assinaturas ou backups.

## Precedente validado

A [PR #245](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/245), commit `7626243`, modernizou **somente o job Firestore**, com `checkout@v7`, `setup-node@v7` e `setup-java@v6`. Seus seis workflows de checks passaram, incluindo Android e CodeQL nas quatro linguagens. Nos logs do job Firestore, as novas actions foram carregadas e o aviso do runtime Node 20 das versões antigas desapareceu.

O job Android obrigatório continuou usando `checkout@v4` e `setup-java@v4` nesse primeiro piloto para isolar o risco. Esta PR segue para o segundo job **de maneira separada e reversível**, sem mudanças no workflow `build-apk.yml`.

## Alterações

- `Obter codigo`: `actions/checkout@v4` → `actions/checkout@v7`, com `persist-credentials: false`.
- `Configurar Java 17`: `actions/setup-java@v4` → `actions/setup-java@v6`.
- `scripts/test_ci_optimization_contract.py`: contrato obriga as novas versões e verifica preservação de Java 17, Gradle 8.13, timeout de 25 minutos, build `testDebugUnitTest/assembleDebug/assembleDebugAndroidTest`, upload de APK debug da PR e ausência de deploy.

**Permanecem iguais:** Android SDK, API 36, build-tools 35.0.0, variáveis de Worker, testes de unidade, compilação do app e androidTest, políticas de concorrência e todas as proteções de upload.

## Critérios de aceite

1. Ambos os jobs `Regras de seguranca Firestore` e `Compilar Android de testes` aprovados na PR.
2. Quatro análises CodeQL, revisão de dependências, verificação de versão e segurança pública aprovadas.
3. Logs devem comprovar execução de `checkout@v7` e `setup-java@v6` no job Android, sem erros ou avisos de runtime Node 20 associados a essas actions.
4. Nenhum deploy ou assinatura oficial: upload apenas do artefato de testes da PR como já definido.
5. Caso os checks falhem, não incorporar; não atribuir ganhos de duração sem medições comparáveis.

## Limite de escopo

As PRs automáticas do Dependabot para atualizar ações em **muitos** workflows continuam independentes. A compatibilidade desse piloto não autoriza mesclar mudanças globais em jobs de produção, OTA ou distribuição.

Veja o [piloto Firestore anterior](piloto-actions-node24-firestore-2026-11-11.md) e a [política de minutos para runners padrão](politica-minutos-actions-repositorio-publico.md).
