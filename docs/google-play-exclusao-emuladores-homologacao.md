# Homologação de exclusão de contas — Auth e Firestore Emulators

**Escopo**: PR #71, somente contas fictícias, sem produção. A CI anterior
testava o protocolo de exclusão em memória. Esta etapa importa da PR #98
a suíte administrativa de ponta a ponta para executar Firebase Admin SDK
**real apenas contra Firebase Auth Emulator**, Firestore Emulator e mídia
fictícia servida por HTTP no loopback.

## Passos verificáveis da CI

No job Firestore do workflow existente `.github/workflows/selos-ci.yml`:
1. Os testes originais (Node 20) permanecem obrigatórios.
2. Após sucesso, instala-se Node 22 com suporte a SQLite e
   `firebase-admin@14.5.0` **somente no fixture QA**.
3. `firebase emulators:exec` executa os testes com projeto
   `demo-atrio-v11`, Auth em `127.0.0.1:9099` e Firestore em
   `127.0.0.1:8089`.
4. A suíte valida UID idêntico no Auth/Firestore, duas contas de teste,
   escopo relacional, status/pedido de titular, lease SQLite, ordem das
   etapas, retomada após erros, preservação de dados de terceiros,
   imagens em HTTP local e Auth **por último**.

`GOOGLE_APPLICATION_CREDENTIALS`, service account e Cloudinary de
produção são proibidos. O teste falha em configuração não fictícia.
**Não rodar a suíte contra ambiente ou credenciais reais**. Nenhum Worker,
APK, assinatura, release ou Firebase de produção é modificado.

## Sem autorização para publicar

Mesmo que todos os testes passem: não existem IAM e autenticação de
revisores homologados para exclusão real, fencing completo dos
Workers implantados, decisão jurídica de retenção, inventário vivo,
Cloudinary real aprovado, portal HTTPS funcional e operação observável.
Aprovação desta suíte é **QA de emuladores**, não prova de conformidade
com a LGPD, Play ou eliminação real.

Manter `docs/google-play-privacidade-evidencias.json` com todas as linhas
`verified:false` e `releaseAuthorized:false` até evidências
operacionais distintas e revisão por responsável.

## Teste de solicitação na UI do perfil — QA Auth + Firestore Emulator

A suíte instrumentada `ThreeBotsAuthenticatedAndroidUiTest` inclui agora o cenário
`titularRegistraExclusaoNoServidorEEncontraPedidoAposNovoLogin`, usando apenas
uma conta fictícia `demo-atrio-v11` e as portas do emulador com `adb reverse`.
O bot abre **Perfil > Exclusão de conta e dados**, confirma o pedido, aguarda
o feedback da UI que exige leitura `Source.SERVER`, valida `status`, origem
`android`, data gerada no servidor e ausência de gravações pendentes.
Após sair e entrar novamente, exige que a mesma conta veja o pedido anterior,
sem oferecer outro formulário, e que a data original não seja alterada.

O teste **não apaga o usuário, mídias, conteúdo ou Firebase Auth** e não implica
que exista executor de produção. O teste não substitui a homologação em APK
instalado pela Play Store ou o portal externo. Nenhuma evidência `verified`
ou autorização de release deve ser marcada por esse ensaio.

## Canal de atendimento no perfil (02/11/2026)

O cenário instrumentado de exclusão da conta agora valida também que
o e-mail `atriocatolico.privacidade@gmail.com` e a ação de contato
continuam acessíveis depois de um pedido confirmado. O botão apenas
abre o aplicativo de e-mail, sem transmitir dados privados em links
ou substituir a gravação autenticada no Firestore. Não é acionado
durante os testes automatizados para não deixar o emulador isolado.

## Revalidação da autorização imediatamente antes do Auth — QA (02/11/2026)

A preparação de exclusão ganhou uma verificação adicional de **continuidade
da autorização administrativa** no último estágio da simulação. A etapa
`removeQaAuthAfterReconciliation` recebe um callback de aprovação
(`assertAuthorization`) vindo do `caseGuard` do executor. O callback é
verificado antes do inventário assíncrono, após a reconciliação, depois
de esperas de verificações externas e imediatamente antes da chamada
ao adaptador de Auth do emulador. Em cada verificação a posse do lease
SQLite é revalidada.

A nova regressão testa: revogação **durante** a reconciliação,
revogação **durante** o preflight remoto, aprovação ausente, resposta
ambígua e revogação enquanto o adaptador fictício de remoção está em
andamento. Os testes exigem que **a remoção não se inicie quando
a aprovação já foi revogada** e que o código não registre um sucesso
com revogação detectada posteriormente. A conta fictícia de um segundo
usuário permanece intocada.

**Limite importante:** a verificação não consegue desfazer um efeito
remoto que já tenha começado, nem comprova atomicidade entre Firebase
Auth, SQLite e Cloudflare. Se a autorização for revogada *durante*
a execução remota, o resultado é tratado como incerto e necessita
reconciliação. Nenhum procedimento de produção recebeu autorização.

A mudança é exclusiva de `tests/security`, não altera aplicativos
instalados, políticas publicadas, contas reais, backups nem os flags
`verified:false` e `releaseAuthorized:false` da Play.

### Teste de autorização sem Firebase no CI comum

Para evitar downloads de dependências e emuladores redundantes,
o teste unitário do último estágio de Auth recebe um reconciliador
explicitamente injetado. O executor QA passa a função verificada
`assertQaReconciled` de seu próprio módulo; sem função válida, o
último estágio bloqueia antes da remoção. O teste dos casos revogados
é executado via Node 22 e SQLite **sem** Firebase SDK, rede ou segredos
no workflow de AAB **sem assinatura** da PR.


## Exclusão condicional de referências pertencentes a terceiros — 03/11/2026

Na rotina QA de limpeza de referências cruzadas
`tests/security/admin-fixture/qa-admin-foreign-reference-cleanup.mjs`,
a remoção no Firestore Emulator usa agora o **precondition
`lastUpdateTime`** do último snapshot revalidado, além das verificações
de escopo, lease SQLite e autorização do operador. Se o titular do
registro o modificar entre a leitura e a chamada de exclusão, o
Firestore rejeita a operação como `FAILED_PRECONDITION`; o processo
falha com `qa_foreign_reference_cleanup_concurrent_record_changed`
e exige nova inspeção, sem apagar a versão recém-modificada.

O teste integrado no Firebase Emulator usa duas contas fictícias,
intercala uma edição do destinatário da notificação e do bloqueio
entre a leitura e a exclusão e verifica que os **dois documentos
sobrevivem** à tentativa concorrente. Não há reprocessamento
automático ou exclusão de denúncias, conteúdo de terceiros ou conta
Firebase Auth real.

A mudança **não** torna a rotina um executor de produção nem garante
atomicidade entre serviços externos. A faixa Play permanece bloqueada
até decisões de retenção, identidade operacional, congelamento
distribuído e testes reais homologados.


## Lease assíncrono e revisão de documentos durante exclusão de subcoleções — 03/11/2026

As duas rotinas administrativas de QA para referências de terceiros e
subcoleções próprias agora **aguardam** o callback de posse do lease.
Uma resposta explícita `false`, um retorno inesperado ou uma
rejeição assíncrona impede imediatamente a exclusão. Para preservar
a assinatura já usada pelo lease SQLite, verificadores síncronos que
lançam erro em caso de perda e retornam `undefined` em caso de posse
continuam aceitos.

O procedimento de exclusão de descendentes próprios passa a ler
cada documento imediatamente antes da remoção e a fornecer sua
`lastUpdateTime` como pré-condição de exclusão ao Firestore
Emulator. Um registro atualizado entre essa leitura e a exclusão
gera `qa_owned_descendant_purge_concurrent_owned_document_changed`
e mantém a nova versão. Pais ausentes de subcoleções órfãs são
ignorados somente depois da enumeração e da revisão do escopo.

A mesma suíte Admin SDK local, executada no CI Firestore existente,
inclui regressões para: perda assíncrona do lease nas duas rotinas,
modificação concorrente de um descendente, persistência do registro
alterado e preservação do usuário de controle. Os testes não
modificam a execução de produção e **não concedem autorização**
para eliminar dados reais. Não há garantia de atomicidade com Auth,
Cloudinary ou Workers implantados; a homologação continua pendente.
