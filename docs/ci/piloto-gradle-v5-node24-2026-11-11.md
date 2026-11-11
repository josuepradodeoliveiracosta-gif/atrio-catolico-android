# Piloto Gradle Actions v5 — Node 24 com cache tradicional preservado

**Data:** 11/11/2026. **Objetivo:** remover a depreciação do runtime Node 20 de `gradle/actions/setup-gradle@v4` no job **Compilar Android de testes**, sem alterar o Gradle instalado, o cache e os testes obrigatórios.

## Evidência

- Na [PR #246](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/246), `checkout@v7` e `setup-java@v6` passaram no job Android, mas o log ainda avisava de Node 20 nas actions de upload e Gradle v4.
- A PR de piloto `upload-artifact@v7` foi separada desta, para validar o nome e a integridade do artefato antes de mexer no Gradle.
- A [release oficial do Gradle Actions v5.0.0](https://github.com/gradle/actions/releases/tag/v5.0.0) declara **somente a migração de runtime para Node 24** e runners GitHub >= 2.327.1 como mudança incompatível principal.
- O arquivo `setup-gradle/action.yml` da tag `v5.0.0` declara `runs.using: node24` e **não define** o parâmetro `cache-provider`. A separação entre cache `enhanced` (comercial) e `basic` (MIT) foi introduzida em [v6](https://github.com/gradle/actions/releases/tag/v6.0.0).

## Alteração pequena

```yaml
- name: Configurar Gradle 8.13
  uses: gradle/actions/setup-gradle@0723195856401067f7a2779048b490ace7a47d7c # v5
  with:
    gradle-version: '8.13'
```

**Inalterados:** Java 17, Android SDK 36, `gradle :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest --no-daemon --stacktrace`, uploads de testes, CodeQL, Firestore, gatilhos, tempo limite e concorrência. Nenhuma alteração no `build-apk.yml`, nos pipelines OTA/release, secrets, produção ou backups.

Um contrato offline exige o uso de v5 exclusivamente neste job e verifica o `gradle-version`, sem adotar `cache-provider` e sem modificar os caches de workflows de produção.

## Critérios de aceite

1. Suíte completa Android e Firestore, quatro linguagens CodeQL, versão, dependências e segurança aprovadas na PR.
2. Log do job Android comprova `setup-gradle@v5` em runner compatível, cache funcional e ausência do aviso Node 20 associado ao Gradle.
3. Verificar que a compilação conclui, o artefato debug preserva nome e prazo e os testes de contrato não regrediram.
4. Não alegar ganho de velocidade apenas pela atualização do runtime. Após incorporação, comparar medianas com amostras equivalentes.
5. Se o cache sofrer regressão material ou houver falha de segurança/compilação, não incorporar.

## Por que não v6 imediatamente

A v6 altera o cache padrão para `enhanced`, que utiliza componente comercial sujeito a termos adicionais. O modo `cache-provider: basic` é MIT, mas utiliza chaves e recursos diferentes e pode aumentar misses; não é substituto automaticamente equivalente aos caches v4/v5. Este piloto escolhe **v5** para modernizar o runtime sem adotar novas condições de licenciamento nem enfraquecer a estratégia atual.

Referências: [Gradle Actions v5](https://github.com/gradle/actions/releases/tag/v5.0.0), [Gradle Actions v6](https://github.com/gradle/actions/releases/tag/v6.0.0), [manual de cache Gradle](https://github.com/gradle/actions/blob/main/docs/setup-gradle.md).
