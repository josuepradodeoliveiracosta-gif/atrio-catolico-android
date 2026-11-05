# Átrio Católico — identidade da assinatura OTA oficial

**Estado da implementação técnica:** validação por certificado fixado no aplicativo, por assinatura instalada, por pacote Android, versão e hash SHA-256. **Aprovação para distribuição oficial:** ainda bloqueada, sujeita à homologação física e autorização específica.

## Identidade do assinante

O certificado SHA-256 público de referência é o do APK **oficial 0.20.0 / versionCode 35** já examinado no projeto:

`ba2e86eacf32e2785718040d704609d3c95c3b88363c08dd3d7c5abe299902b0`

A mesma identidade pública deve permanecer em:
- `app/src/main/java/br/com/atriocatolico/OtaOfficialSigner.kt` (cliente Android)
- `scripts/ota_release_cert.py` (validação do APK no CI)

O teste `scripts/test_ota_release_cert.py` compara ambas para detectar divergência. O hash do certificado é público; nenhuma chave privada ou senha é copiada para o aplicativo.

## O que o APK de produção verifica

1. A API de descoberta e o manifesto pertencem ao repositório e ao release estável esperado. Redirecionamentos HTTP externos, circulares e URLs fora da allowlist são rejeitados.
2. O manifesto identifica exatamente `br.com.atriocatolico`, contém um APK de tamanho e SHA-256 válidos, declara uma versão superior à instalada e informa a mesma assinatura da instalação atual.
3. **Novo bloqueio:** o certificado do APK **instalado** deve coincidir também com o certificado público **oficial fixado no cliente**. Uma cópia do aplicativo assinada com outra chave não pode aceitar uma atualização como oficial mesmo que ela seja consistente com o próprio certificado.
4. Após o download, o arquivo é conferido quanto a tamanho, SHA-256, packageName, versionCode, versionName e assinatura do APK. A identidade oficial é verificada novamente antes do botão de instalação.
5. Somente a ação explícita do usuário abre o instalador Android. O Android ainda exige as permissões e confirmações aplicáveis.

**Exceção restrita ao laboratório:** quando `BuildConfig.DEBUG && BuildConfig.OTA_QA_LOOPBACK`, o pacote `br.com.atriocatolico.otalab` pode usar o certificado Debug temporário do runner, conservando obrigatória a igualdade de assinaturas entre APK instalado e candidato. `app/build.gradle.kts` impede essa configuração em tarefas Release.

## Critérios para disponibilização real

- Todos os checks de GitHub Actions verdes; os testes automatizados de `.otalab` **não substituem** o teste oficial.
- Verificar em aparelho Android físico que uma **versão oficial historicamente assinada** é atualizada por um **candidato mais novo com a mesma assinatura**, sem desinstalar e preservando dados, sessão e preferências. Conferir o certificado extraído dos dois APKs e o `versionCode` instalado; a simples compilação não prova essa etapa.
- Confirmar que o manifesto publicado e o APK assinado são exatamente os inspecionados e que o GitHub Release estável é o pretendido.
- Solicitar autorização explícita do fundador **após** a homologação física e cumprir os gates independentes de e-mail e Guardião V2. Só então habilitar `ATRIO_OTA_E2E_TESTED` e `ATRIO_OTA_RELEASE_APPROVED`, nunca antes nem por automação.
- Caso seja necessária rotação de chave, exigir projeto e homologação próprios; não substituir silenciosamente o fingerprint fixado.

**Atenção:** esta preparação do código não cria candidato oficial assinado, não ativa publicação e não declara que a homologação física do canal oficial foi realizada.
