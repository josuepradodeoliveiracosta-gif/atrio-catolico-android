# Átrio Católico — execução final para o teste fechado Google Play

**Documento operacional, não uma autorização de lançamento.**
Branch: `feature/play-closed-testing-aab-20261031`. PR #71 (draft).
App: `br.com.atriocatolico`; candidata Play `0.20.2`, `versionCode 37`, `targetSdk 36`.
Os números da versão precisam ser conferidos de novo antes de assinar, sobretudo se um novo APK OTA for publicado.

## Situação efetivamente verificada

- AAB Play **sem assinatura** aprovado na execução GitHub Actions `41262009257` (31/10–01/11/2026), incluindo manifesto e testes isolados.
- APK, regras Firestore, Guardião, selos, relay Push e segurança passaram nessa revisão.
- **Não houve assinatura do AAB, upload no Play Console, faixa fechada iniciada, publicação de site ou implantação de executor.**
- Evidências de privacidade **0/9** e UGC **0/6**, todas `verified:false`; `releaseAuthorized:false`.
- Interface Android para solicitar exclusão: código integrado, testes no Emulator.
- Portal de exclusão: código integrado; o formulário **permanece bloqueado**. Não afirmar URL pública nem capacidade de atendimento.
- Plano e coordenação de exclusão: apenas QA com contas fictícias, incluindo testes de falhas e de freeze; **não apagam conta real**.
- Não houve verificação do Play Console (não conectado a esta conversa), dos certificados reais ou de testadores inscritos.

## Ordem obrigatória para habilitar primeira distribuição na faixa fechada

| Prioridade | Responsabilidade | Trabalho e comprovação necessária | Critério de aceite |
| --- | --- | --- | --- |
| 1 | Responsável pelo app + revisão jurídica | Confirmar nome do controlador, contato público de suporte/privacidade, direitos dos titulares, categorias de dados religiosos, prazos e razões legais de retenção | Política revisada e aprovada, sem campos `[A CONFIRMAR]` |
| 2 | Engenharia + revisão de segurança | Integrar barreira persistente **em todas** as escritas reais de Avatar, Guardião, Push, filas, cron, fanout, D1, Firebase Admin e Cloudinary; proteger sessões/efeitos em andamento | QA multiusuário/concorrente e teste de não regressão completos, sem bypass |
| 3 | Engenharia + revisão jurídica | Executor idempotente real de exclusão e reconciliação (Auth **por último**), segurança de identidade administrativa e decisões de retenção | Caso isolado e ponta a ponta comprovado, sem apagar dados de terceiros |
| 4 | Engenharia + responsável | Publicar política HTTPS e portal web de solicitação **funcional e utilizável sem APK**, com atendimento real e recuperação de acesso | URL externa validada em navegador anônimo e pedido de teste reconhecido; não revelar credenciais |
| 5 | Responsável + QA | Moderar conteúdos, publicar termos versionados e exigir aceite antes de UGC; homologar denúncia, bloqueio bilateral e Push respeitando bloqueio **na infraestrutura ativa** | Cinco controles UGC pré-envio com evidência e revisão real |
| 6 | Responsável + revisão LGPD | Preencher e revisar Segurança dos dados, classificação indicativa, acesso do revisor, público-alvo, informações de contato e ficha Play | Declarações coerentes com AAB e serviços realmente ativos |
| 7 | Responsável pelo certificado | Decidir Play App Signing comparando **certificado de assinatura do aplicativo** com os APKs OTA existentes; validar certificado **de upload** separadamente; preparar segredos no GitHub sem copiá-los em PR/chat | Compatibilidade de upgrade estabelecida ou migração explicitamente planejada |
| 8 | CI + responsável | Somente após gates verdadeiros, revisar evidências e executar assinatura manual, validar AAB e realizar upload pelo Play Console | AAB assinado aceito na faixa fechada, sem instalador OTA |
| 9 | Testadores + QA | Instalar **pela faixa fechada** e testar exclusão, termos, denúncia, bloqueio, notificações, migração, login e Android 16; registrar evidências `closed_track_e2e` e `closed_track_ugc_e2e` | QA E2E pós-upload homologada, não preenchida retroativamente |
| 10 | Responsável Play Console | Cumprir eventual requisito de conta pessoal nova (12 testadores inscritos continuamente por 14 dias) e solicitar acesso à produção posteriormente | Aprovação do Play Console; não confundir com início da faixa fechada |

## Informações que só o responsável pode autorizar ou fornecer

Os seguintes dados **não devem ser inventados nem publicados no GitHub**:

1. Conta Play Console verificada, app cadastrado e status do pacote `br.com.atriocatolico`.
2. Identidade/nome jurídico do controlador e **contato público de suporte e privacidade**.
3. Decisões sobre prazos, bases legais e exceções de retenção, inclusive dados relativos à religião.
4. Domínio/URL HTTPS legítimos para política e solicitação de exclusão.
5. Escolha de assinatura do app e conferência das impressões digitais reais **fora de arquivos públicos**.
6. Credenciais de acesso de revisor, listas de testadores e evidências de adesão (somente no Play Console/canal privado).

Nenhum desses pontos pode ser substituído por aprovar manifestos JSON ou publicar artefatos de QA.

## Verificações e pontos de controle

- PR: https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71
- Exclusão: https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/72
- UGC/Push: https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/99
- Gate local de pré-assinatura (não destrutivo): `python3 scripts/play_release_gate.py --audit`
- Modo de assinatura `--enforce` **continua bloqueado** até evidências reais.
- Fontes oficiais: https://support.google.com/googleplay/android-developer/answer/13327111 ,
  https://support.google.com/googleplay/android-developer/answer/9876937 e
  https://support.google.com/googleplay/android-developer/answer/14151465 .

**Proibido antecipar:** merge de PRs incompatíveis, deploy em produção, destruição de conta, geração de nova chave ou aprovação artificial de evidências.


## Continuidade entre o APK já instalado e o certificado Play App Signing

Antes de qualquer assinatura manual, conferir **três certificados distintos**
quando aplicável: (a) certificado de **upload** do AAB, que é verificado
isoladamente por `play_upload_certificate_check.py`; (b) certificado de
**assinatura do aplicativo** mostrado em Play Console > Integridade do
aplicativo; e (c) certificado que assinou **um APK release comprovadamente
instalado** no aparelho de testes (não um APK debug).

Na Configuração > Variables do GitHub, preencher após revisão humana:

- `ATRIO_PLAY_APP_SIGNING_CERT_SHA256`: impressão SHA-256 pública da
  assinatura efetiva do APK que a Google Play entregará.
- `ATRIO_INSTALLED_APK_CERT_SHA256`: impressão SHA-256 pública do APK
  release existente, inspecionado com `apksigner verify --print-certs`
  em uma cópia confiável do APK.

O workflow manual `play-signed-aab-manual.yml` agora executa
`scripts/play_app_signing_continuity.py` e **bloqueia** se qualquer
fingerprint estiver ausente, malformada ou diferente. O certificado de upload
**não pode substituir** o de App Signing. Os valores são SHA-256 de
certificados públicos; nunca publicar JKS, senhas, tokens ou APK privado.

**A igualdade de fingerprints não prova autenticidade nem atualização
instalada:** comparar as fontes oficiais e testar pelo Play Console após
homologar os demais gates. Se forem diferentes, não forçar equivalência:
é necessário um plano documentado de migração/reinstalação e autorização
explícita antes de mudar o processo de lançamento.

O modo CI unsigned apenas testa o algoritmo com valores fictícios.
Não altera nenhum certificado real nem libera `releaseAuthorized`.

## Acesso à política dentro do aplicativo (preparação Play)

A seção **Conta e privacidade > Política de privacidade** abre no navegador a
URL compilada no campo público `BuildConfig.PRIVACY_POLICY_URL`. Nenhuma URL é
inventada; em builds de QA sem configuração, a variante Play informa que a
política está pendente e não deve ser distribuída.

Antes de qualquer assinatura manual, o proprietário deve configurar em
**GitHub → Settings → Secrets and variables → Actions → Variables**:

- `ATRIO_PLAY_PRIVACY_POLICY_URL`: endereço definitivo HTTPS da política
  revisada, acessível sem login, sem parâmetros de sessão e sem bloqueio geográfico.

A CI sem assinatura não usa endereço de produção. No workflow manual, a variável
é encaminhada como `ATRIO_PRIVACY_POLICY_URL`, verificada por
`scripts/play_release_gate.py --enforce` **antes de abrir a chave JKS** e
incorporada ao AAB `playRelease`. Falta de URL, endereço de teste/placeholder,
ausência do botão ou quebra na fonte bloqueiam assinatura.

**Importante:** esta etapa não publica a política, não valida o conteúdo da
página, não comprova o atendimento da LGPD e não libera exclusão de conta.
O requisito `public_privacy_policy` permanece `verified:false` até revisão
documentada em navegador anônimo, dentro do app e na Play Console.

## Novo bloqueio pré-assinatura: portal web externo obrigatório

O controle manual `scripts/play_release_gate.py --enforce` agora também exige
a variável pública `ATRIO_PLAY_DELETION_PORTAL_URL` no GitHub Actions
(Settings → Secrets and variables → Actions → Variables), repassada ao script
como `ATRIO_DELETION_PORTAL_URL`. Ela deve ser a **URL HTTPS definitiva
do formulário web de exclusão**, sem credenciais, query string, fragmento,
endereço local ou domínio fictício. Não confundir com a URL da política
`ATRIO_PLAY_PRIVACY_POLICY_URL`.

O gate bloqueia assinatura se o arquivo do portal estiver ausente,
se o intertravamento explícito `LIVE_INTAKE_REVIEWED_AND_APPROVED`
continuar `false`, ou se os dois controles de backend
`intakeEnabled` e `actualDeletionEnabled` tiverem sido removidos.
Essas verificações são locais e **não comprovam implantação, funcionamento,
autenticação do titular nem exclusão real**. São necessárias verificações
independentes em navegador anônimo, teste E2E do pedido, processamento
efetivo, política jurídica aprovada e evidência assinada pelo responsável.

**Não ativar o formulário para passar no teste**: o executor de exclusão,
as garantias distribuídas de privacidade e a retenção ainda precisam ser
homologados. Não mudar `verified:false` ou `releaseAuthorized:false`
para contornar o gate.

## Inspeção obrigatória do `config.js` gerado antes da assinatura

Foi identificado que o cliente web e o gerador de arquivos públicos possuem
**dois intertravamentos independentes**. Mesmo após trocar manualmente
`LIVE_INTAKE_REVIEWED_AND_APPROVED` para `true` no cliente
(`public/app.js`), `scripts/build.mjs` continua gerando
`intakeEnabled:false` e `actualDeletionEnabled:false` no
`config.js` público. Isso deixaria o formulário indisponível.

O gate de assinatura exige agora que os **dois sinalizadores gerados sejam
explicitamente `true` em uma única configuração estática** e rejeita
configurações incompletas, duplicadas, contraditórias ou gerador ausente.
Os testes de regressão verificam estas falhas. Não foram alterados os
sinalizadores reais do portal: ambos **continuam `false`**, de propósito.

Antes da aprovação humana, ainda é obrigatória a inspeção da página
**efetivamente publicada**, dos arquivos `app.js`/`config.js`
distribuídos, da origem HTTPS, das regras de autenticação, do recebimento
do pedido e do processamento efetivo de exclusão. Checks estáticos não
provam publicação nem execução. Não autorizar assinatura ou upload por
simples mudança de variáveis ou de sinalizadores.

## Avanço para primeira assinatura: exclusão administrativa antes da chave (01/11/2026)

O workflow manual de assinatura `.github/workflows/play-signed-aab-manual.yml`
agora executa **obrigatoriamente antes de qualquer segredo de keystore**
o cenário de processamento de exclusão `admin-fixture/qa-admin-sdk-e2e.test.mjs`
já presente na PR #71. O cenário usa Firebase **Auth Emulator e Firestore
Emulator reais**, projeto `demo-atrio-v11`, API de mídia HTTP `localhost`,
SQLite de testes, dois usuários fictícios, dupla aprovação simulada,
freeze de escritas, retomada após falhas e remoção do Auth fictício apenas
após checagem dos dados. Verifica que o segundo usuário não é apagado.

Isso fecha uma lacuna de **orquestração do processo de assinatura**:
o gate anterior dependia apenas de evidências JSON e testes unitários do
controle de privacidade. A partir de agora, falha do cenário administrativo
impede chegar à leitura dos segredos e ao build assinado. A CI AAB também
valida estruturalmente a presença e a ordem dessa etapa, sem duplicar
o teste longo em cada compilação.

**Limitação obrigatória:** esse processo NÃO remove contas reais, NÃO
garante a implantação do executor, NÃO prova IAM, retenção jurídica,
cobertura de mídias legadas ou fencing nos Workers ativos, e NÃO habilita
o portal. O workflow continua manual, restrito à `main`, com gates
`PLAY_AAB_APPROVED`, `GUARDIAN_APPROVED` e `--enforce` prévios;
continua sem publicar na Google Play. Nenhum segredo novo foi criado.


## Alternativa oficial mais simples para o link externo (02/11/2026)

A política atual do Google Play permite que a **solicitação externa** de
exclusão seja iniciada por e-mail público de atendimento divulgado em
uma página HTTPS clara. Não é obrigatório disponibilizar autenticação
Firebase e exclusão automática no navegador. Referência:
https://support.google.com/googleplay/android-developer/answer/13327111?hl=pt-BR

Por isso a PR #71 prepara, de forma separada e sem deploy, a página
estática em **cloudflare/account-deletion-support/** e o modo opcional
**manual-support** do gate de pré-assinatura. A via Firebase permanece
padrão, com os bloqueios existentes. Para usar o caminho de e-mail é
necessário aprovar contato público, atendimento real, política, retenção,
autenticação do titular, serviço de processamento efetivo de exclusão
e comprovação do site em navegador anônimo. Ver procedimento completo:
**docs/google-play-exclusao-atendimento-manual.md**.

**Não confundir rapidez na abertura de pedidos com redução de exigências.**
Ainda não há contato real homologado, política pública validada, página
implantada, inbox operante comprovada ou exclusão real aprovada.
Os 9 requisitos de privacidade e 6 de UGC continuam sem evidência
homologada. Não assinar ou enviar AAB apenas porque a opção manual
foi codificada.


## Ligação direta da URL externa no Android (02/11/2026)

O pacote Android mantém a seção autenticada de solicitação no perfil e
agora aceita a URL HTTPS pública da Play no campo público
**BuildConfig.DELETION_WEB_URL**. O build lê exclusivamente
**ATRIO_DELETION_PORTAL_URL**, já fornecida pelo workflow de assinatura
manual a partir da variável GitHub Actions
**ATRIO_PLAY_DELETION_PORTAL_URL**.

A URL vazia é normal em QA. Somente quando for configurada uma URL
HTTPS real, sem credenciais, query string, fragmento ou porta insegura,
aparecerá o botão **"Solicitar exclusão pelo site"** na tela
**Perfil > Exclusão de conta e dados**. O botão abre o navegador sem
enviar UID, conta, token ou texto privado; se falhar, orienta o usuário
a recorrer ao e-mail público. Na variante Play sem URL o aplicativo
mostra explicitamente que a página de exclusão está pendente.

O gate estático de pré-assinatura confirma a presença e os estados
seguros dessa integração, além dos gates já existentes que exigem
comprovação da URL. O gate ao vivo lê o site HTTPS publicado. Nenhum
destes testes substitui comprovar recebimento, processamento ou
remoção de dados reais.

**Hospedagem — atualização de 02/11/2026**: foi criado
na conta Cloudflare conectada o projeto de homologação
`atrio-catolico-privacidade-qa`, separado dos serviços existentes.
API confirmou `latest_deployment: null`, sem integração Git ou
implantação de site. O endereço `atrio-catolico-privacidade-qa.pages.dev`
está reservado para **QA e é recusado pelos gates da Play como URL
de produção**. Permanecem pendentes a revisão da política,
publicação efetiva de páginas HTTPS e o procedimento real de exclusão.
Ver `docs/google-play-hospedagem-pages-qa.md`.

## Identificação pública do controlador — 02/11/2026

O titular escolheu constar como **pessoa física**, sem empresa registrada. O **nome civil completo** ainda aguarda confirmação literal antes de integrar a política pública. Não inferir o nome completo do identificador GitHub nem solicitar CPF como substituto. A escolha não libera nenhum requisito do manifesto de privacidade, publicação, assinatura ou deploy.
