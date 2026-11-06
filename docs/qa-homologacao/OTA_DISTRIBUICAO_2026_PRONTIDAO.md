# Prontidão da distribuição oficial do Átrio — revisão de 06/11/2026

**Decisão vigente:** preparar o canal OTA HTTPS público, **sem assinar, distribuir ou publicar novo Release oficial** até todas as condições e uma aprovação posterior, expressa e separada. A homologação A → B em aparelho físico vale para o *piloto privado em loopback*, não equivale a testar o GitHub CDN.

## Canal escolhido pelo código — GitHub Releases HTTPS

O cliente Release normal consulta somente `https://api.github.com/repos/josuepradodeoliveiracosta-gif/atrio-catolico-android/releases/latest`, exige Release estável e URLs exatas de `update.json` e `atrio-catolico.apk` no mesmo repositório e usa TLS/hosts aprovados no download. Em 06/11/2026 a API oficial respondeu 404 e a listagem de Releases públicos estava vazia (`[]`).

**Importante:** não criar uma Release pública de ensaio apenas para aparentar E2E. Não há como comprovar o download real do CDN GitHub sem um asset da origem real acessível, e um teste somente de leitura não prova a instalação por essa origem. Não converter automaticamente a homologação local em autorização para publicar.

## Situação da verificação de desenvolvedor Android no Brasil

Fontes oficiais:
- [Android Developers — Developer verification](https://developer.android.com/developer-verification/guides)
- [FAQ sobre sideload e o prazo de setembro](https://developer.android.com/developer-verification/guides/faq?hl=pt-br)

Em **30/09/2026** o requisito passou a ser aplicado a instalações por **lojas participantes** em regiões como Brasil, Indonésia, Singapura e Tailândia, em aparelhos Android certificados. Conforme FAQ, esse marco **não passa a bloquear automaticamente o sideload direto de APK via GitHub**. A ampliação da verificação para distribuição em aparelhos certificados está prevista para 2027. O futuro fluxo de instalação pode variar conforme origem, dispositivo, região e cadastro.

Para distribuição **exclusivamente fora da Play Store**, o canal recomendado de registro é o **Android Developer Console**. A modalidade de distribuição limitada destina-se a testes pequenos (até 20 dispositivos segundo documentação oficial); a modalidade ampla exige verificação de identidade. Se houver futura publicação na Play Store, os procedimentos aplicáveis são os do **Play Console**.

**Não existe evidência nos registros do projeto de que o titular já tenha concluído o cadastro/verificação do pacote** `br.com.atriocatolico`. Não presumir nem ativar qualquer sinalização de conta verificada. O cadastro, a opção comercial e a aprovação de distribuição dependem de ação explícita do titular.

## Bloqueios concretos encontrados no código

1. **Versão incompatível:** o `defaultConfig` do Release normal em `app/build.gradle.kts` ainda indica **0.20.1 / versionCode 36**. O APK piloto B de assinatura permanente, instalado no aparelho físico sem perder dados, está em **0.20.2 / versionCode 37**. Um futuro APK oficial deve superar ambos os valores (por exemplo **0.20.3 / versionCode 38** ou maior, dependendo da numeração que for autorizada). Não gerar ou publicar 0.20.1/code36 como atualização para o aparelho já homologado. **Esta revisão não altera o número da versão**.
2. **Artefato legado:** o fluxo histórico 0.20.0 / code35 não contém o OTA necessário para atualizar pelo próprio app. Pode ser validado em verificações somente leitura, mas **não pode servir como Release estável OTA a publicar**.
3. **Paridade de gates:** `build-apk.yml` exige aprovação OTA, confirmação obrigatória de e-mail e Guardião V2; o job de **publicação** antes da revisão não incluía o Gate do Guardião V2. A revisão torna a aprovação obrigatória tanto no pré-voo de publicação quanto no job final, inclusive mantendo o gateway oficial.
4. **Prova de canal:** o GitHub Releases público ainda não contém um APK oficial acessível. A auditoria de TLS/contrato é positiva; a entrega pública e o instalador por esse canal continuam **não homologados**.

## Proteção adicional de versão, sem gerar APK

Os validadores de somente leitura agora têm comandos:

```sh
# Na main atual, o resultado esperado é FALHA: 0.20.1/code36.
python3 -m scripts.ota_release signing-readiness --gradle-file app/build.gradle.kts

# Para um artefato aprovado de outro build, verificar metadados de origem.
# Exige artefato oficial normal e versão superior ao piloto 0.20.2/code37.
python3 -m scripts.ota_release publish-readiness --source-json source.json
```

Esses comandos **nunca assinam, instalam ou publicam**. O workflow de assinatura executa a primeira verificação antes de usar a chave permanente; o fluxo de publicação executa a segunda antes de baixar o APK oficial, e o job final valida versão e Guardião novamente. Uma falha mantém tudo bloqueado.

## Checklist de liberação futuro

- [x] Atualização real do piloto `0.20.1/code36 → 0.20.2/code37` no mesmo aparelho com certificado permanente e consentimento Android.
- [x] Dados e sessão preservados, confirmados pelo titular.
- [x] Testes negativos automatizados para hash, certificado, downgrade, download cancelado, permissão recusada, armazenamento simulado, falhas de rede e redirects externos.
- [x] Falha de conexão e recuperação comprovadas no piloto local.
- [x] Consulta somente leitura e contrato de metadados do canal HTTPS GitHub.
- [ ] Definir versão de produção **maior que 0.20.2/code37**, revisar o `defaultConfig`, compilar e auditar candidato somente mediante autorização apropriada.
- [ ] Confirmar cadastro do desenvolvedor e do pacote na modalidade de distribuição escolhida; verificar experiência atual de instalação fora de lojas participantes.
- [ ] Validar distribuição real do asset do GitHub CDN e instalação/atualização por esse canal, sem divulgar antecipadamente aos usuários sem aprovação.
- [ ] Verificar também as aprovações independentes de **e-mail obrigatório e Guardião V2** em ambiente produtivo.
- [ ] Registrar evidências sanitizadas na [issue #149](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/149) e obter **autorização expressa e separada** de assinatura e publicação.
- [ ] Somente após o aceite, considerar os gates `ATRIO_OTA_E2E_TESTED` e `ATRIO_OTA_RELEASE_APPROVED` conforme política, além dos demais gates. **Não ativá-los agora**.

**Segurança:** preservar o keystore permanente, os backups originais, o Firebase e Cloudflare produtivos. Não inserir senhas, chaves privadas, contas pessoais ou capturas com dados identificáveis nos logs ou issues públicas.
