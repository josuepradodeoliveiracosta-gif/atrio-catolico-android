# Átrio Católico — preparação para o primeiro lançamento público

**Situação inicial (06/11/2026): NÃO PUBLICAR.** O canal de distribuição escolhido no projeto é o **GitHub Releases por HTTPS**, como instalação Android fora da Play Store. O lançamento de Google Play/AAB é uma trilha distinta, ainda sem homologação e sem aprovação de loja.

## Candidato de código, ainda não um APK distribuível

Esta branch prepara apenas os **metadados** da versão normal Release **0.20.3 / versionCode 38**, superior ao piloto **0.20.2/code37** instalado e homologado fisicamente. `applicationId` continua `br.com.atriocatolico`; certificado, Firebase, chave permanente, backend e OTA do canal estável não são alterados. A versão Debug e a variante `otaPilot` continuam independentes.

O comando `python3 -m scripts.ota_release signing-readiness --gradle-file app/build.gradle.kts` deve confirmar a numeração, mas devolve **`signing_authorized:false` e `distribution_authorized:false`**. Um número de versão válido **nunca autoriza** uma assinatura ou publicação.

**Esta PR não gera nem assina um novo APK Release, não cria um GitHub Release, não altera variáveis de autorização, não altera backups e não implanta serviços produtivos.**

## Estado de evidências (sem repetir testes aprovados)

- [x] OTA de laboratório Release A→B `0.20.1/code36 → 0.20.2/code37`, certificado oficial fixo, download dentro do app e consentimento do instalador Android em aparelho físico.
- [x] Preservação de sessão, discussões, publicações e preferências relatada pelo proprietário.
- [x] Testes automatizados de hash/certificado errado, downgrade, recusa de permissão, cancelamento do download, rede e espaço simulado.
- [x] Falha de conexão e recuperação no dispositivo físico, com ausência de oferta de reinstalação.
- [x] Confirmação obrigatória de e-mail: produção `ACTIVE`/`ready:true`, regras Firestore coincidentes; duas contas QA reais com `allPassed:true` e **6/6** resultados API pós-ativação, além de fluxo de verificação via Android Debug (ver [issue #134](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/134)).
- [x] Auditoria da **API** GitHub Releases pública: `latest` 404, lista `[]`; contrato offline de metadados HTTPS aprovado. **Isto não comprova download CDN real**.
- [x] Travas de assinatura/publicação separadas para OTA, e-mail e Guardião V2, além de confirmação manual `PUBLICAR ATRIO`.
- [ ] **Homologar integração produtiva do Guardião V2**, incluindo versão realmente implantada do gateway, identidade, políticas e comportamento autorizado. A PR #175 corrigiu o código de `redirect: manual` **somente no GitHub**, não foi implantada na Cloudflare.
- [ ] **Confirmar exigências e registro do desenvolvedor Android** para a modalidade escolhida e documentar a experiência real em Android certificado no Brasil. Não presumir registro ou verificação de identidade concluídos.
- [ ] Após **autorização separada**, integrar a versão candidata à `main`, gerar e assinar uma Release normal **0.20.3/code38** no workflow manual protegido, usando a **mesma chave permanente**, sem publicar. Conferir Android package, assinatura, SHA-256, versão e origem do artefato.
- [ ] Com artefato autorizado, validar instalação sobre o piloto code37, preservação de sessão e dados, e QA de regressão funcional. Não desinstalar o app para corrigir falhas.
- [ ] Resolver o **limite inevitável do canal público**: sem uma Release acessível não há como comprovar a transferência real pelo GitHub CDN. A divulgação do primeiro asset exige aceitação expressa do risco residual e plano de rollback/retirada e comunicação; **não criar Release pública antecipadamente sem autorização**.
- [ ] Executar o workflow de `validate` primeiro; autorizar `publish` somente depois de evidência sanitizada, revisão de aprovação Guardião, email, OTA e autorização específica do proprietário. Não ativar flags antecipadamente.
- [ ] Verificar no aparelho a versão já entregue via GitHub HTTPS e o processo de atualização subsequente; manter monitoramento inicial e procedimento de resposta para falhas de distribuição sem colocar credenciais no repositório.

## Ordem de execução e portões

1. **GO técnico de código:** revisão e CI da PR de metadados 0.20.3/code38.
2. **GO de integração:** Guardião V2 e infraestrutura de e-mail/FireStore comprovados no estado realmente implantado (não basta código local); registro Android avaliado.
3. **GO de assinatura:** autorização específica para assinar um APK oficial na `main`, sem publicar; validações de artefato e instalação privada.
4. **GO de divulgação:** autorização explícita do responsável para criação de GitHub Release público, após avaliação do risco residual CDN, logs, recuperação e política de distribuição.

Cada etapa é independente. **Nunca ligar `ATRIO_OTA_E2E_TESTED`, `ATRIO_OTA_RELEASE_APPROVED`, `ATRIO_EMAIL_VERIFICATION_RELEASE_APPROVED` ou `ATRIO_GUARDIAN_V2_RELEASE_APPROVED` apenas para fazer uma execução passar.** Corrigir as evidências e obter as autorizações antes. Também não modificar backup, keystore, sessão de usuário, regras Firestore ou Worker produtivo sem escopo e aprovação explícitos.

Evidências técnicas e decisões: [issue #149](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/149); [issue #134](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/134).
