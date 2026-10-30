# Átrio Guardião — isolamento real do APK Debug de QA (30/10/2026)

O workflow do Guardião compilava anteriormente um APK de QA contendo os recursos de Firebase do projeto oficial e a URL do Worker de Push. Essas compilações **não são adequadas para teste isolado no celular**, apesar de serem Debug e de a CI executar apenas testes automatizados.

## Correção, somente na branch de QA

- O job Android Debug remove `app/google-services.json` **somente na cópia temporária do GitHub Actions**, sem tocar o arquivo original no repositório ou no Firebase.
- Os endereços `ATRIO_PUSH_WORKER_URL`, `ATRIO_GUARDIAN_WORKER_URL` e `ATRIO_AVATAR_WORKER_URL` são forçados a vazios no build.
- A variável `ATRIO_GUARDIAN_QA_ISOLATED=1` adiciona o sufixo de pacote Android `br.com.atriocatolico.guardianqa`. Não substitui o pacote oficial `br.com.atriocatolico`.
- `MainActivity` **força o modo de demonstração local** quando `BuildConfig.GUARDIAN_QA_ISOLATED` estiver ativo, mesmo que algum processo inicialize Firebase por acidente. Isso impede login e operações conectadas no build isolado.
- A CI verifica a ausência de configuração de produção antes do build, compila e testa a aplicação e audita o **APK gerado** com `aapt` para conferir o pacote separado e recusar opções Firebase ou endereços de Workers de produção.
- O novo artefato chama-se `guardiao-qa-demo-local-isolado`, diferente dos APKs anteriores `guardiao-autonomo-debug-qa`, que não eram suficientemente isolados. **Não instalar os artefatos antigos para testar o Guardião.**
- Essa proteção não muda os builds oficiais de Android. Na ausência da flag, a configuração e o `applicationId` originais continuam sem alterações.
- O APK Debug de demonstração ainda pode declarar a permissão INTERNET herdada do app principal. **O LAB offline `guardian-lab-android-offline` é a opção comprovada sem permissão de internet**; não anunciar o APK de demonstração como totalmente offline.

## Verificações obrigatórias antes de recomendar o novo APK

1. CI do Guardião em `success` com `GUARDIAN_QA_ANDROID_ISOLATION_PASS` em prebuild e auditoria do APK.
2. Novo artefato `guardiao-qa-demo-local-isolado` gerado pelo job aprovado.
3. Teste Android Emulator permanece isolado com Firebase Auth/Firestore locais, nunca produção.
4. Nenhum acesso ao Worker oficial, merge, aprovação Release, alteração de backup ou faturamento.

**Custo zero e moderação autônoma permanecem NO-GO de produção.**
