# Átrio Católico — liberação condicionada à homologação OTA real

**Decisão do responsável em 05/11/2026:** não gerar, assinar, distribuir nem publicar novos APKs **Release oficiais** enquanto as atualizações OTA não estiverem implementadas, ativadas em um canal controlado e comprovadas **dentro do próprio aplicativo em um aparelho real**.

## Estado verificado nesta revisão

- A `main` já possui `OtaUpdatePolicy`, `OtaReleaseClient`, `OtaApkDelivery` e a tela `OtaUpdatesSection` integrada ao Perfil. São implementações reais, mas **não uma homologação ponta a ponta**.
- O app consulta a última GitHub Release estável (assets `update.json` e `atrio-catolico.apk`), confere o manifesto e oferece download/integridade/instalador.
- A rotina OTA **deliberadamente não executa em APK Debug** (`BuildConfig.DEBUG` retorna `TestBuild`). Logo o Debug utilizado para homologar e-mail **não prova que OTA funciona**.
- A prova automatizada `ota-upgrade-qa.yml` usa `adb install -r` entre dois APKs Debug no emulador, **sem abrir o atualizador**. Essa prova não cobre a detecção, download ou instalação pelo fluxo dentro do aplicativo.
- Na consulta ao repositório de 05/11/2026, não havia GitHub Releases públicos cadastrados. **Não criar release público apenas para aparentar que OTA foi testado.**
- O primeiro APK que contenha OTA ainda precisará ser instalado **uma vez por meio externo**. A experiência de atualizar dentro do app só é demonstrável entre essa instalação-base e outra versão posterior, com mesmo pacote e certificado e `versionCode` crescente.
- No Android de distribuição fora da Google Play, o usuário pode precisar autorizar a origem de instalação e confirmar a atualização pelo instalador. Não prometer atualização silenciosa sem interação.

## Travas novas, independentes

Os workflows `.github/workflows/build-apk.yml` (assinatura) e `.github/workflows/ota-publish-release.yml` (publicação) só permitem uma operação oficial quando **ambas** as variables de repositório são exatamente `true`:

- `ATRIO_OTA_E2E_TESTED`: somente após comprovação e registro de um ciclo de atualização **real no dispositivo, pelo fluxo da interface**: detectar, baixar, conferir arquivo/certificado, solicitar instalação Android, concluir e voltar ao app.
- `ATRIO_OTA_RELEASE_APPROVED`: aprovação **posterior, explícita e separada** do responsável pelo lançamento e pela ativação do canal.

A ausência das variables equivale a `false`; qualquer outro valor bloqueia a operação. Essas duas travas **se somam** às existentes para confirmação de e-mail, Guardião V2, chaves de assinatura e confirmação de publicação. Não definir as variables antecipadamente, não contornar checks criando outro workflow ou assinando manualmente um Release para distribuição.

**Permitidos enquanto bloqueado:** construção Debug e testes isolados de assinatura, APKs de QA em ambiente de testes, auditoria de metadados, estudos de canal piloto e validação sem publicação. Um eventual APK de QA para medir OTA não é autorização para distribuí-lo como Release oficial.

## Plano de homologação

1. Implementar um **canal OTA piloto isolado**, de modo que duas versões de QA possam exercitar a interface de consulta, download e instalador. Não reutilizar a assinatura oficial em pacotes de QA sem necessidade e não apontar canal de testes para produção. Como `BuildConfig.DEBUG` bloqueia OTA, é necessário primeiro planejar e implementar uma rota de teste explícita, segura e separada.
2. Validar origem HTTPS, manifesto e `versionCode` com duas versões reais de teste assinadas **com a mesma chave**. Testar também URL divergente, arquivo corrompido, SHA-256 incorreto, assinatura diferente e versão inferior ou repetida. Nenhuma dessas falhas deve abrir o instalador.
3. Em Android real, partir da versão A, abrir a tela **Perfil → Atualizações do Átrio**, descobrir versão B, concluir o download dentro do app, autorizar o instalador Android e instalar B **por cima de A**, sem remover nem perder sessão, configurações e dados locais. Conferir também interrupção de rede, cancelamento, falta de espaço e retentativa.
4. Confirmar o funcionamento da assinatura **permanente** do canal de produção, o certificado e os incrementos de `versionCode` antes de qualquer divulgação, sem expor o JKS nem suas senhas.
5. Registrar capturas/logs sem dados sensíveis, o dispositivo/API Android usado, o par de versões e seus hashes, o resultado completo e o retorno ao app. Só após aceitação do responsável marcar `ATRIO_OTA_E2E_TESTED=true`; solicitar uma **segunda aprovação** antes de marcar `ATRIO_OTA_RELEASE_APPROVED=true`.
6. Mesmo após ambos os gates, a assinatura e a publicação oficial continuam sujeitas aos demais gates e às ações manuais autorizadas. **Não publicar Release automaticamente** ao concluir testes.

**Backup protegido:** não editar o backup original nem recriar a chave de assinatura oficial. Testes e artefatos temporários permanecem separados.

## Próxima implementação

A primeira pendência concreta é desenvolver e ativar o canal piloto no aplicativo de QA para demonstrar OTA dentro da interface, porque o OTA da build Debug atual está desabilitado e a prova com `adb install -r` não atende à condição de lançamento.
