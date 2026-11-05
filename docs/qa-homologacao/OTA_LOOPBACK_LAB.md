# Átrio Católico — laboratório OTA isolado (GitHub Actions + Android/Termux)

**Data:** 05/11/2026. **Estado:** implementação de laboratório; não confundir com OTA ativado em produção.

## Revalidação complementar — integridade negativa e persistência (05/11/2026)

O proprietário concluiu no aparelho Android real a sequência 0.19.7 → 0.19.8 pela tela do laboratório, com consulta, download interno, confirmação do instalador Android e reconhecimento da versão atualizada. **Essa prova é do laboratório Debug de pacote isolado, não do canal assinado oficial.**

Para tornar a próxima execução de QA mais forte:
- A tela do laboratório oferece **Salvar marcador local de teste** e exibe **Marcador local preservado: SIM/NÃO**. Esse marcador fica somente em `SharedPreferences` da instalação `.otalab`, não utiliza Firebase nem dados pessoais.
- O CI grava o marcador **pela UI do aplicativo antigo**, instala o APK novo por cima usando ADB e lê o mesmo marcador no diretório privado. Uma falha no valor impede aprovação.
- O CI inicia o servidor local em quatro modos sucessivos: `valid`, `bad-cert`, `bad-hash` e `downgrade`. Testes instrumentados verificam, respectivamente, download permitido, certificado incompatível bloqueado antes de baixar, hash inválido recusado após download e downgrade sem oferta.
- O laboratório apresenta versões e estados como **de teste**, evitando confundi-los com publicações oficiais. Os textos da versão de produção não mudam.
- Se for necessário repetir a prova física com um novo artefato do CI, as chaves Debug temporárias podem diferir entre execuções: desinstale **somente a instalação de laboratório `.otalab`**, depois instale o APK antigo do **mesmo** novo artefato. Não desinstale o Átrio original e não presuma preservação de dados entre APKs assinados por chaves de teste diferentes.

**Ainda exigido antes do Release:** funcionamento do canal estável GitHub Releases com certificado permanente conhecido, testes de assinatura/versionCode/ausência de downgrade, preservação de login e dados em versão assinada, e autorização final específica do proprietário. Não configurar antecipadamente as duas variáveis de liberação OTA.

## O que foi reaproveitado

A mesma implementação de produção `OtaReleaseClient`, `OtaUpdatePolicy`, `OtaApkPolicy`, `OtaApkDelivery`, `OtaUpdateController` e `OtaUpdatesSection` detecta, baixa, confere e oferece o botão de instalação. Nenhuma segunda implementação de downloader ou de validador de assinatura foi criada.

O laboratório fornece apenas o canal de metadados e a tela inicial para não exigir autenticação real.

### Isolamento

- O laboratório só é ativado em **Debug** quando `ATRIO_OTA_QA_LOOPBACK=1` é informado **durante a compilação**.
- Pacote separado `br.com.atriocatolico.otalab`: não substitui `br.com.atriocatolico` instalado.
- Firebase Google Services **não é aplicado** a esta compilação; tela de QA não acessa autenticação ou dados reais.
- Origem exclusiva: `http://127.0.0.1:8765`, acessível apenas no próprio Android. No emulador, `adb reverse tcp:8765 tcp:8765` conecta ao host do CI. Não há endpoint externo de testes.
- O manifesto Debug existente `qa_emulator_network_security.xml` já libera loopback; o Release mantém HTTPS e os hosts oficiais GitHub.
- Build Debug normal **continua mostrando “Versão de testes”** e não executa OTA. Build Release nunca recebe a flag `OTA_QA_LOOPBACK=true`, mesmo se alguém definir a variável.
- As duas variáveis `ATRIO_OTA_E2E_TESTED` e `ATRIO_OTA_RELEASE_APPROVED` continuam **falsas/ausentes** até homologação completa e autorização independente.
- O backup oficial e o keystore permanente não são usados nem alterados.

## O que o CI comprova

Workflow `.github/workflows/ota-in-app-qa.yml`:

1. Compila os dois APKs `Debug` de QA no **mesmo runner** (versões `0.19.7/code 34` e `0.19.8/code 35`) com a mesma chave temporária.
2. Confirma pacote de laboratório e SHA-256 do certificado e prepara `update.json` para o APK mais novo.
3. Disponibiliza artefato temporário `atrio-ota-lab-debug-par` com os dois APKs e `update.json`.
4. Inicia servidor HTTP **somente em 127.0.0.1**, utiliza `adb reverse` para o emulador, instala versão antiga.
5. Testa no cliente OTA real do Android: detectar atualização e baixar até o botão `Instalar atualização`; o botão só aparece após validar tamanho, SHA-256, pacote, versão e certificado.
6. Com ADB, aplica versão nova por cima e comprova preservação de arquivo local, **sem alegar instalação pelo botão Android**.

Este QA automatizado **não substitui** o teste humano do instalador, a confirmação de sistema nem o teste da assinatura oficial, que permanecem pendentes.

## Teste no Android real sem interferir no app atual

**Somente após o CI aprovar e disponibilizar o pacote de QA**:

1. No GitHub Actions, baixar `atrio-ota-lab-debug-par` e extrair `atrio-old-debug.apk`, `atrio-new-debug.apk` e `update.json` no telefone.
2. Instalar **apenas** `atrio-old-debug.apk`, de pacote `.otalab`. O app Átrio original não precisa ser desinstalado.
3. No Termux, usar `python3` com `scripts/ota_qa_loopback_server.py` da revisão aprovada; manter o script, `update.json` e `atrio-new-debug.apk` disponíveis. Exemplo, dentro da pasta com arquivos:

   ```sh
   python3 ota_qa_loopback_server.py --apk atrio-new-debug.apk --manifest update.json
   ```

   Essa execução **não exige Android SDK no telefone**: compara SHA-256 e tamanho do APK com o manifesto assinado e verificado previamente pelo CI. Não abra portas para a rede: o servidor só aceita `127.0.0.1:8765`.
4. Abrir o app separado **Átrio Católico — Laboratório OTA** (pacote `.otalab`). Deve aparecer nova versão `0.19.8`.
5. Tocar em **Baixar atualização**, acompanhar o progresso e esperar o botão **Instalar atualização**. Se surgir mensagem de bloqueio, não forçar instalação nem desativar proteções gerais.
6. Tocar em **Instalar atualização**. Se Android solicitar, permitir instalação **desta fonte** e confirmar pelo instalador do sistema. O Android pode pedir para voltar ao app e tocar em Instalar outra vez.
7. Reabrir o laboratório. Se o aplicativo já estiver em `0.19.8`, a consulta deve mostrar **atualizado**; a instalação anterior e seus dados locais devem persistir.

Ensaio negativo complementar: iniciar o servidor com `--mode bad-hash`, `bad-cert` ou `downgrade` (reiniciando-o entre cenários); nenhuma dessas respostas deve permitir baixar/instalar um APK inválido. Repetir com rede local indisponível ou servidor desligado; deve mostrar falha de consulta sem instalar nada.

**Não enviar senhas, tokens, keystore ou capturas contendo credenciais.** Os APKs e o manifesto do laboratório não são um Release oficial.

## Critério de passagem para produção

A prova no celular de QA valida o mecanismo de OTA no próprio Android. Depois, ainda é necessário comprovar o uso da assinatura permanente, preparar o primeiro Release autorizado (a primeira instalação com OTA exige instalação convencional), demonstrar atualização de uma versão posterior pelo app e assegurar a preservação de dados reais de teste. Só após aprovação explícita do responsável devem mudar as variáveis do bloqueio de Release. Nunca publicar automaticamente.
