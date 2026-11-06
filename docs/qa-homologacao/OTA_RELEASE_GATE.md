# Átrio Católico — liberação condicionada à homologação OTA real

**Decisão do responsável em 05/11/2026:** não gerar, assinar, distribuir nem publicar novos APKs **Release oficiais** enquanto as atualizações OTA não estiverem implementadas, ativadas em um canal controlado e comprovadas **dentro do próprio aplicativo em um aparelho real**.

## Estado verificado nesta revisão

- A `main` já possui `OtaUpdatePolicy`, `OtaReleaseClient`, `OtaApkDelivery` e a tela `OtaUpdatesSection` integrada ao Perfil. São implementações reais, mas **não uma homologação ponta a ponta**.
- O app consulta a última GitHub Release estável (assets `update.json` e `atrio-catolico.apk`), confere o manifesto e oferece download/integridade/instalador.
- O **Debug normal** continua sem OTA e retorna `TestBuild`. O **laboratório Debug isolado** (`ATRIO_OTA_QA_LOOPBACK=1`, pacote `br.com.atriocatolico.otalab`) reutiliza o cliente real, sem Firebase de produção, e já passou por homologação de atualização no aparelho; não é um APK Release oficial.
- O ensaio histórico `ota-upgrade-qa.yml` usa `adb install -r`, sem atualizar pela interface. O laboratório mais recente `ota-in-app-qa.yml` exercita detecção, download, validações, falhas e preservação de marcador na **UI real**; a instalação pelo botão do Android foi comprovada separadamente em telefone físico no pacote isolado. A assinatura oficial e a persistência de sessão de produção ainda não foram comprovadas.
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

1. **Concluído no laboratório:** canal OTA piloto isolado `.otalab` com duas versões de QA, mesma assinatura temporária, UI de detecção, download e instalador Android. Não reutilizar a assinatura oficial em pacotes de QA nem apontar o canal de testes para produção. Essa prova não substitui a etapa de assinatura permanente.
2. Validar origem HTTPS, manifesto e `versionCode` com duas versões reais de teste assinadas **com a mesma chave**. Testar também URL divergente, arquivo corrompido, SHA-256 incorreto, assinatura diferente e versão inferior ou repetida. Nenhuma dessas falhas deve abrir o instalador.
3. Em Android real, partir da versão A, abrir a tela **Perfil → Atualizações do Átrio**, descobrir versão B, concluir o download dentro do app, autorizar o instalador Android e instalar B **por cima de A**, sem remover nem perder sessão, configurações e dados locais. Conferir também interrupção de rede, cancelamento, falta de espaço e retentativa.
4. Confirmar o funcionamento da assinatura **permanente** do canal de produção, o certificado e os incrementos de `versionCode` antes de qualquer divulgação, sem expor o JKS nem suas senhas.
5. Registrar capturas/logs sem dados sensíveis, o dispositivo/API Android usado, o par de versões e seus hashes, o resultado completo e o retorno ao app. Só após aceitação do responsável marcar `ATRIO_OTA_E2E_TESTED=true`; solicitar uma **segunda aprovação** antes de marcar `ATRIO_OTA_RELEASE_APPROVED=true`.
6. Mesmo após ambos os gates, a assinatura e a publicação oficial continuam sujeitas aos demais gates e às ações manuais autorizadas. **Não publicar Release automaticamente** ao concluir testes.

**Backup protegido:** não editar o backup original nem recriar a chave de assinatura oficial. Testes e artefatos temporários permanecem separados.

## Compatibilidade com a verificação de desenvolvedor Android (Brasil, 2026)

A partir de **30/09/2026**, a verificação de desenvolvedor Android começou no Brasil, Indonésia, Singapura e Tailândia **nas lojas participantes**. O cronograma oficial prevê expansão global a partir de 2027. É incorreto afirmar, apenas por essa data, que todo APK baixado de GitHub Releases esteja proibido; a documentação também descreve instalação por fluxo avançado e por ADB. No entanto, o percurso real pode variar por dispositivo certificado, loja, origem e atualização do sistema.

**Antes da distribuição:**
1. Confirmar a modalidade de distribuição pretendida: APK do GitHub instalado diretamente, loja participante, Play Store ou grupo limitado. Não tratar esses caminhos como equivalentes.
2. Verificar no **Android Developer Console** ou **Play Console**, conforme a modalidade escolhida, o status de registro do desenvolvedor e do pacote oficial `br.com.atriocatolico`; não presumir cadastro já concluído. Manter o mesmo certificado de assinatura usado pelos APKs oficiais. Nunca publicar nem enviar a chave privada ou suas senhas.
3. Ensaiar num aparelho Android certificado no Brasil **a origem real de instalação**: atualização A → B pelo fluxo `Perfil → Atualizações do Átrio`, consentimento de fontes externas, verificação do desenvolvedor quando aplicável, confirmação do instalador e retorno ao app sem perda de sessão/dados. Registrar a versão do Android, a origem e eventuais telas de bloqueio **sem dados sensíveis**.
4. Para instalação direta de um app ainda não registrado, considerar o fluxo avançado documentado pelo Android e as limitações de experiência; ADB é ferramenta de desenvolvimento, não deve ser anunciado como rotina simples para usuários finais.
5. Não confundir a homologação do APK no laboratório `.otalab` com a aprovação do pacote oficial ou com o registro de desenvolvedor. As duas variáveis de autorização OTA e as demais travas de Release permanecem inalteradas até aceite explícito.

**Fontes oficiais consultadas em 05/11/2026:** [Android Developers — guia de verificação](https://developer.android.com/developer-verification/guides), [Android Developers Blog — lançamento no Brasil e outras regiões](https://android-developers.googleblog.com/2026/06/android-developer-verification.html) e [Android Developer Console — FAQ](https://support.google.com/android-developer-console/answer/16561738?hl=en).

## Continuidade do certificado de assinatura permanente — proteção adicional

O APK oficial histórico **0.20.0 / versionCode 35** foi assinado e conferido no workflow GitHub Actions [41174393714](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41174393714). O certificado público (não a chave privada) possui fingerprint SHA-256:

`ba2e86eacf32e2785718040d704609d3c95c3b88363c08dd3d7c5abe299902b0`

O novo verificador **somente de leitura** `scripts/ota_release_cert.py` aplica uma trava adicional: mesmo que um APK passe pela verificação criptográfica do `apksigner`, o workflow de assinatura oficial deve **recusar entrega** caso o assinante não corresponda ao certificado público do APK 0.20.0. A preparação de `update.json` também exige que a configuração do certificado oficial corresponda a esse valor; alterar apenas a variável do repositório **não** contorna a referência.

**Limitações:** a referência histórica não prova que toda instalação anterior de usuários utiliza o mesmo certificado; a compatibilidade precisa ser conferida em aparelhos reais. Uma futura rotação de chave é uma operação excepcional que deve ser explicitamente autorizada, documentada e testada com as regras de continuidade/linhagem de assinatura do Android, antes de alterar essa referência. Não incluir JKS, chave privada, aliases secretos ou senhas nos registros. Esta revisão não assina, instala nem publica novos APKs e não libera as variáveis de homologação OTA.

## Próxima implementação

O laboratório piloto já foi integrado e exercitado em aparelho real com versões 0.19.7 → 0.19.8. **Pendências concretas:** confirmar no Android real os cenários de armazenamento insuficiente e retomada após falhas, validar comportamento e registro do Android certificado no Brasil, conferir assinatura permanente e canal GitHub Releases, testar preservação de sessão/dados em duas versões oficiais quando existir autorização expressa para o piloto assinado e só depois avaliar os gates de publicação. Os cenários de cancelamento já foram aprovados no laboratório emulado. Nenhum Release é autorizado por este documento.


## Atualização de evidência — piloto físico A → B (06/11/2026)

Os apontamentos de 05/11 acima eram o estado **anterior à homologação física**. Em 06/11 o proprietário realizou um ciclo OTA privado real no aparelho Android, sem desinstalar o Átrio.

- **Procedência e assinatura:** [run manual #4, 42182257048](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/42182257048), sucesso. Base A `0.20.1/versionCode36` e candidato B `0.20.2/versionCode37` assinados com o mesmo certificado permanente SHA-256 `ba2e86eacf32e2785718040d704609d3c95c3b88363c08dd3d7c5abe299902b0`.
- **Hashes individuais verificados:** A `0d1928794a518189b6917ab37fe3f6b4d8e76c70c74670b33d52dc1baf769fd5` e B `517df453a3b5d1897c11b63027a6e62cab5648b1b86331c3bf2fcc17a66cc719`.
- **E2E no aparelho:** A detectou B no servidor privado loopback, baixou e exibiu "APK verificado"; o instalador Android pediu confirmação de atualização; ao concluir, Perfil exibiu a versão B `0.20.2` e a conta autenticada.
- **Persistência:** à pergunta específica sobre sessão, discussões, publicações e preferências, o usuário confirmou "Tudo intacto". A evidência é relato do titular corroborado pelas capturas da UI, não auditoria dos dados privados.
- **Privacidade:** as capturas contêm identificadores pessoais. Não as anexar ao GitHub público; usar descrições sanitizadas na [issue #149](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/149).

**Critério alcançado:** atualização OTA do piloto privado A→B em aparelho real, com assinatura permanente e preservação de sessão/dados. **Não foi comprovado** o canal HTTPS público do GitHub Releases nem todos os testes negativos em dispositivo físico. O laboratório automatizado cobre várias recusas, mas testes em emulador não substituem prova física.

**Continuam pendentes:** testar recusa de permissão de instalação, rede indisponível/cancelamento, hash/assinatura/versionCode inválidos e espaço insuficiente em ambiente isolado, confirmar a modalidade real de distribuição e canal estável HTTPS do GitHub, e obter autorização distinta para distribuir. Não ligar `ATRIO_OTA_E2E_TESTED` ou `ATRIO_OTA_RELEASE_APPROVED` antecipadamente e não alterar backup/keystore.

**Regressão encontrada e corrigida:** a primeira execução de piloto falhou ao importar `scripts.*` através de `python3 scripts/ota_release_cert.py`. A PR #171 corrigiu o workflow de piloto; os demais workflows oficiais devem usar `python3 -m scripts.<modulo>` e testes de regressão para não repetir a falha.
