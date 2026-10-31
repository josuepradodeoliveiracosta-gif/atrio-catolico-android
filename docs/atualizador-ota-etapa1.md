# Atualizador integrado do Átrio — Etapa 1: assinatura e pré-publicação

Auditoria em 31/10/2026; base remota da análise:
`30e1fc4a3701170808b71b62fc0adc50c7198c05`.
O projeto e o aplicativo em produção **não** são alterados por este procedimento.
Este documento não significa que o atualizador já esteja instalado.

## Evidências que já existem

- `app/build.gradle.kts`: pacote `br.com.atriocatolico`, release `0.20.0` e `versionCode = 35`.
- `.github/workflows/build-apk.yml` só assina o release por disparo manual na `main`, condicionado à chave privada protegida e à aprovação do backend já prevista no workflow.
- Houve build **concluído com sucesso** do APK assinado `0.20.0` em [Actions #41174393714](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41174393714), SHA de origem `fcf063e835c37ca1e3f9363a56a4232d30cb8ea0`.
- Artefato: `atrio-catolico-0.20.0-release-assinado`, ID `13031693723`; retenção informada até 07/11/2026, 05:56 UTC.
- O gatilho excepcional que produziu esse artefato já foi retirado da `main` no commit `30e1fc4a3701170808b71b62fc0adc50c7198c05`. Não reativar.
- Até a auditoria, GitHub Releases não tinha publicação. Artefatos temporários de Actions **não** servem como canal permanente de download para o público.
- A API retornou `protected=false` para `main`. Configurar regras de proteção/revisão pela interface do proprietário antes de automatizar publicações.

**Ainda não comprovados:** o fingerprint do certificado efetivamente instalado nos aparelhos dos amigos, a instalação sobre um APK antigo, a presença da variável `ATRIO_RELEASE_CERT_SHA256` e um download público permanente.

## Ferramenta de validação sem assinatura ou acesso ao Firebase

O script `scripts/ota_apk_preflight.py` utiliza `apksigner` e `apkanalyzer` para conferir o APK recebido:

1. Um único assinante válido e fingerprint SHA-256 do certificado previamente confiável.
2. Pacote exato `br.com.atriocatolico` e APK **não** depurável.
3. `versionCode` e `versionName` aprovados; SHA-256 do arquivo (opcionalmente comparado com hash previamente conhecido).
4. Quando fornecido um **APK antigo**: certificado idêntico e `versionCode` novo estritamente maior.

Exemplo em ambiente de testes com Android SDK configurado:

```bash
python3 scripts/ota_apk_preflight.py \
  --apk /CAMINHO/SEGURO/app-release.apk \
  --expected-cert "IMPRESSAO_DIGITAL_SHA256_CONFIAVEL" \
  --expected-code 35 \
  --expected-name 0.20.0 \
  --previous-apk /CAMINHO/SEGURO/app-release-anterior.apk
```

O argumento `--previous-apk` é opcional. Sem APK anterior, a ferramenta **não** declara compatibilidade de atualização.
O certificado esperado **deve vir da chave original guardada em segurança ou de um APK oficial previamente verificado**. Nunca aceitar o certificado de um APK desconhecido como a própria referência de confiança.

Para verificar sem instalar ou recompilar o artefato assinado que já existe no GitHub, este trabalho também fornece o workflow manual `OTA etapa 1 — conferir APK assinado (somente leitura)`.
Ele só pode executar na `main` após integração revisada, com permissões de leitura. Não acessa secrets de assinatura, não recompila, não publica, não instala no aparelho, não modifica Firebase/Cloudflare. Exige a variável não secreta `ATRIO_RELEASE_CERT_SHA256` com a impressão digital confiável.

Parâmetros da primeira auditoria:
- `apk_run_id: 41174393714`
- `artifact_name: atrio-catolico-0.20.0-release-assinado`
- `expected_version_code: 35`
- `expected_version_name: 0.20.0`
- `expected_apk_sha256`: preencher somente se o SHA-256 do APK já foi obtido de fonte independente.

Para compilações oficiais **futuras**, o workflow aceita apenas artefatos `atrio-catolico-release-assinado` produzidos por `build-apk.yml` com disparo manual na `main`. O artefato excepcional de 0.20.0 fica limitado ao run e commit explícitos acima.

## Critério para finalizar a etapa 1

- [x] Preservar o pacote do Android, numeração release e configuração de assinatura permanente no código.
- [x] Comprovar existência e conclusão bem-sucedida do build 0.20.0; retirar o gatilho excepcional.
- [x] Preparar script, testes e workflow manual de pré-publicação na branch de desenvolvimento.
- [ ] Revisar/integrar a PR de pré-publicação e confirmar o fingerprint confiável, sem mostrar senhas/JKS.
- [ ] Executar o pré-voo real e guardar como evidência o SHA-256 do arquivo e o certificado validado.
- [ ] Testar a substituição no celular de uma versão **release** anterior e conferir login/dados.
- [ ] Tratar a migração **uma única vez**, caso amigos estejam usando APK debug com certificado diferente; antes de desinstalar, verificar conta e dados locais.
- [ ] Ativar Ruleset para `main` e revisar checks obrigatórios no GitHub.

**Não avançar para oferta pública OTA sem aprovação dessas verificações.**

Etapa 2, separada: publicar um APK já aprovado em GitHub Releases e disponibilizar um manifesto de versão seguro. Não confundir a publicação de artefatos do Actions com download público permanente.
