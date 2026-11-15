# Verificação manual da integridade do APK oficial

O workflow `qa-official-apk.yml` baixa um APK assinado já existente do artefato
`atrio-catolico-release-assinado`, gerado por `build-apk.yml`. Confere a execução
de origem e o vínculo do artefato, o SHA-256 do APK, o certificado permanente,
o pacote `br.com.atriocatolico`, `debuggable=false` e o identificador Firebase
`atrio-catolico` lido dos recursos do APK. Registra a versão e o commit de origem.

Os testes de Clara, Miguel e Lúcia pertencem ao APK `qaGeral`, com Auth e
Firestore Emulator. A verificação oficial usa o GitHub e as ferramentas locais
de inspeção do APK.

## Configuração e execução

1. Em **Settings → Secrets and variables → Actions**, configure a variável
   `ATRIO_RELEASE_CERT_SHA256` com a impressão digital pública do certificado
   permanente já conhecido. O formato aceita dois-pontos.
2. Em **Gerar APK do Atrio Catolico**, escolha a execução aprovada que contém o
   artefato assinado. Anote o ID da execução e calcule o SHA-256 do APK extraído
   com `sha256sum app-release.apk`.
3. Em **Actions → Conferir integridade do APK oficial → Run workflow**, informe
   `apk_run_id` e `apk_sha256`. O workflow aceita o disparo manual inicial no
   repositório oficial.

O artefato `qa-official-evidence-RUN_ID` contém `apk.json` com o resultado da
inspeção. Um resultado aprovado comprova a integridade e a identidade do APK
selecionado. A homologação no aparelho é uma etapa separada.

## Testes locais

```sh
python3 -m unittest discover -s tests/qa_official -v
```

O workflow `qa-official-checks.yml` roda esses testes com dados simulados nas PRs.
