# Piloto de modernização do upload do APK de testes — Node 24

**Data:** 11/11/2026. **Escopo:** apenas o upload de artefato **debug** dentro do job obrigatório `Compilar Android de testes`. Nenhuma mudança em publicação, assinatura ou canal de release.

## Evidência e motivo

Na [PR #246](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/246), o job Android executou com sucesso `actions/checkout@v7` e `actions/setup-java@v6`. Ainda apareceu no log o aviso do runtime Node 20 para as actions `actions/upload-artifact@v4` e `gradle/actions/setup-gradle@v4`.

A release `actions/upload-artifact@v7` utiliza runtime Node 24 e introduziu upload direto **opcional** (`archive: false`), que ignoraria o nome configurado e mudaria o formato. Portanto, este piloto seleciona explicitamente `archive: true`, o comportamento existente de ZIP.

## Alteração pequena e reversível

- `actions/upload-artifact@v4` → `actions/upload-artifact@v7`.
- `archive: true`: mantém um artefato ZIP e o nome configurado.
- Mantidos: `name: atrio-catolico-v0190-debug-testes`, `path: app/build/outputs/apk/debug/app-debug.apk`, `if-no-files-found: error`, `retention-days: 7` e condição `github.event_name == 'pull_request'`.
- Contrato obrigatório `scripts/test_ci_optimization_contract.py` passa a verificar os parâmetros exatos e prevenir uma mudança acidental para upload direto.
- **Inalterados:** `gradle/actions/setup-gradle@v4`, Gradle 8.13, JDK 17, SDK Android, compilação, testes Android, Firestore e CodeQL; sem alterações de secrets, regras de produção, OTA, backups, APK oficial ou quaisquer workflows de release.

## Critérios de aceite

1. Suíte Android e Firestore, CodeQL nas quatro linguagens, segurança, versão e dependências aprovados.
2. Confirmar no log que `upload-artifact@v7` foi carregado e que a etapa de upload terminou com sucesso, sem aviso Node 20 atribuído ao upload.
3. Confirmar nos metadados do run um artefato com **nome correto**, estado íntegro e prazo de retenção esperado; verificar a disponibilidade sem baixar conteúdo do APK.
4. Preservar as proteções atuais de envio apenas em PRs e de falha se o arquivo estiver ausente.
5. Não alegar ganho de velocidade antes de comparar amostras. Se falhar, não incorporar; reverter exclusivamente esta troca.

## Risco adiado: Gradle v6

A documentação de `gradle/actions/setup-gradle@v6` confirma que o cache `enhanced` padrão utiliza um componente comercial com termos específicos; existe um `cache-provider: basic` MIT com menos recursos, que usa chaves e comportamento distintos. Isso exige decisão separada para evitar regressão de cache e mudança implícita de licenciamento. **A presente PR não altera o Gradle.**

Fontes: [upload-artifact](https://github.com/actions/upload-artifact), [releases](https://github.com/actions/upload-artifact/releases), [Gradle setup](https://github.com/gradle/actions/blob/main/docs/setup-gradle.md).
