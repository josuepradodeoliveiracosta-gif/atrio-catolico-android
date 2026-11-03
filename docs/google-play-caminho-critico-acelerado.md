# Átrio Católico — caminho crítico acelerado para Google Play
**Atualização:** 02/11/2026 · PR #71 (rascunho) · sem deploy, sem merge e sem modificação de backups ou produção.

## Decisão de foco
**Pausar a expansão de protótipos sintéticos de broadcast** após corrigir vulnerabilidades reais e preservar seus testes. A prioridade agora é liberar um **primeiro pacote de teste fechado que cumpra as políticas**, antes de otimizar notificações para grandes volumes. A compilação Android não é o bloqueio dominante; a candidata Play `0.20.2`, code `37`, targetSdk `36`, já teve AAB **não assinado** aprovado. Assinar, carregar na Play Console, testar num aparelho pela Play e declarar conformidade são fases distintas.

## Trabalho em paralelo — bloqueios reais

| Frente | Entrega objetiva | Dependência / responsável | Como comprovar |
| --- | --- | --- | --- |
| **A. Política e conta** | Identidade do controlador, canal público, política de privacidade e termos comunitários revisados, URLs HTTPS reais | Responsável pelo app e revisão jurídica/LGPD | Política e termos acessíveis em navegador anônimo e pelo app; histórico de versão; sem placeholders |
| **B. Exclusão efetiva** | Pedido iniciável dentro do app e pela web, identificação segura, atendimento e exclusão dos dados associados; exceções de retenção justificadas | Engenharia + operador autorizado; não ativar portal existente até existir atendimento real | Solicitação em duas identidades de QA e processamento ponta a ponta com evidência; outra conta preservada; nenhuma saída de dados reais em testes |
| **C. Comunidade UGC** | Aceite de termos vigente antes de postar; denúncias de post, resposta e usuário; bloqueio de membros e moderação operacional | Engenharia + moderação e política de conteúdos | Testes de duas contas em emulador, depois aparelho; Rules e Push não contornáveis por cliente legado |
| **D. Assinatura e Play Console** | Confirmar app `br.com.atriocatolico`, suporte, ficha da loja, Segurança dos dados, classificação, público-alvo, acesso do revisor e certificados | Titular da conta Play Console | Conferência de dados no Console, integridade do app, compatibilidade com APK atual, assinatura manual aprovada |
| **E. Teste fechado** | Após primeiros gates, enviar **manualmente** AAB assinado e realizar instalação pela Play | Titular do Console + testadores | Link de adesão, instalação real, evidências pós-upload para exclusão/UGC; somente depois considerar produção |

O Google permite que a solicitação externa de exclusão use **formulário ou atendimento**, sem exigir necessariamente autoexclusão imediata no navegador. Contudo, a opção precisa funcionar, ser clara e remover os dados associados quando o pedido for processado, salvo retenções legalmente justificadas. **Não basta congelar a conta.** As regras de UGC exigem aceite de termos e mecanismos de denúncia, bloqueio e moderação apropriados.
Fontes oficiais: https://support.google.com/googleplay/android-developer/answer/13327111 e https://support.google.com/googleplay/android-developer/answer/9876937 .

## O que pode ser feito agora, sem credenciais novas
- Concluir código e testes de integração de B e C no emulador, sem ativar nem modificar backend real.
- Revisar os campos da política e os rascunhos da ficha da loja em paralelo, coletando as decisões de titularidade, suporte e retenção fora do repositório público.
- Validar o caminho de assinatura e de migração de certificado, **sem criar chave** e sem copiar certificados privados ou senhas.
- Manter o `--enforce` bloqueado até haver URLs/serviços reais, testes e revisores; preservar `verified:false` e `releaseAuthorized:false`.

## Aceleração do CI sem dispensar segurança
O workflow `play-closed-aab-ci.yml` continua executando as verificações de privacidade, auditoria de evidências, exclusão de QA e gates de assinatura em alterações relevantes. A compilação `bundlePlayRelease` só é dispensável em eventos `pull_request:synchronize` quando o histórico anterior é comprovadamente ancestral e **todos** os arquivos alterados pertencem à lista fechada de backend, documentos ou testes isolados. Novo PR, execução manual, diff faltante, histórico reescrito ou arquivos desconhecidos = **recompilar AAB**. O workflow informa quando NÃO construiu AAB naquela revisão; um resultado verde não é uma homologação do pacote. O workflow de assinatura manual sempre compila integralmente.

Paths antes não incluídos na CI Play agora acionam as verificações: `cloudflare/privacy-batch-stage/**`, `cloudflare/privacy-freeze-stage/**`, `cloudflare/push-worker/**`, `tests/security/**`, `firestore.rules`, configuração Gradle na raiz e auditoria Firebase.

## Critérios de decisão, sem atalho falso
- Manifesto atual: **0/9 controles de privacidade** e **0/6 controles UGC** com evidência homologada; os testes de faixa fechada são necessariamente posteriores ao primeiro envio.
- O requisito de **12 testadores contínuos por 14 dias** aplica-se, para solicitar acesso à produção, a contas pessoais criadas depois de 13/11/2023. Não é pré-requisito para **começar** o teste fechado. Fonte: https://support.google.com/googleplay/android-developer/answer/14151465 .
- Não assinar, fazer upload, alterar flags de produção, liberar broadcast por tópico ou publicar o portal até revisão operacional e autorização específica.
- Guardar evidências verdadeiras com revisor e data; jamais preencher o manifesto automaticamente para aprovar um release.

**Próxima implementação com melhor retorno:** fechar B (atendimento e exclusão efetiva) e C (teste UGC ponta a ponta), além de resolver em paralelo os dados públicos e materiais do Console. A homologação Cloudflare independente é uma dependência de engenharia quando exigida pelo desenho adotado, não uma razão para continuar adicionando QA sintético sem fim.


## Bloqueio de comunicados FCM legados na variante Play — 02/11/2026

A variante `playRelease` não deve se inscrever em
`atrio_comunicados_v1`: comunicados em tópico não conseguem respeitar
individualmente bloqueios, exclusões ou desativação de destinatários.
Agora `PushRegistry.register` tenta **desinscrever** o tópico geral na
variante Play, preservando a inscrição do APK OTA legado. A rotina de
sincronização também tenta remover tópicos antigos das discussões.

O receptor Play só mostra `kind=broadcast` quando a mensagem de dados
contém o `uid` exatamente igual ao usuário autenticado **e não provém
de um tópico FCM**. Mensagens sem destinatário ou com outro UID são
ignoradas. A política pura `PlayBroadcastDeliveryPolicy` tem teste
JUnit incluído na compilação AAB já existente; não requer novo job.

**Risco remanescente:** a desinscrição FCM depende de rede e não tem
confirmação operacional nesta PR. Em mensagens FCM com payload
`notification`, o sistema pode exibi-las sem passar pelo código do
receptor, principalmente em segundo plano. Portanto é obrigatório
**desligar a emissão por tópicos nos Workers reais** e homologar a
entrega individual `data`, o controle de bloqueio e a exclusão antes de
publicar. O novo filtro Android não autoriza o lançamento nem
substitui barreiras duráveis contra concorrência. Nenhum Worker ativo foi
atualizado e nenhuma notificação real foi enviada.


## Central administrativa também alerta denúncias de usuários (02/11/2026)

A `NotificationCenter` adiciona `user_reports` à categoria
**Administração · denúncias**, junto das denúncias de discussões e
respostas. A consulta é paginada pelo limite atual da Central e as
Firestore Security Rules continuam restringindo a leitura a
administradores. Somente denúncias pendentes são mostradas, com título
genérico, sem motivo, UID ou identificador do denunciante na mensagem.
O identificador guardado nas preferências de leitura é um digest
SHA-256 do ID da denúncia mais o timestamp, evitando salvar UIDs
em claro. A consulta de `user_reports` só alimenta avisos quando
confirmada pelo servidor, sem cache ou gravações locais pendentes;
erro ou sessão incorreta oculta os itens e exibe erro de consulta.

Não foi criado push externo, não houve alteração no Worker, Rules ou
em produção. O aviso abre a moderação existente, onde a fila administrativa
do tipo `user_reports` já é acessível. Os testes JUnit verificam
agrupamento, privacidade do texto/identificador e remoção das
denúncias analisadas da lista de pendências. O painel não é prova
de disponibilidade contínua de moderadores nem autoriza a Play.


## Bloqueio de regressão FCM antes de assinatura Play (02/11/2026)

O gate existente `scripts/play_release_gate.py` executa agora
`play_push_privacy_blockers` nos modos `--audit` e `--enforce`, sem
novo workflow ou serviço. Ele recusa a assinatura se desaparecerem
as proteções do cliente Play contra recebimento de comunicados por
tópicos, migração de inscrições legadas, identificação por UID ou
o bloqueio deliberado do endpoint `/broadcast` no código do Worker.

A suíte offline `scripts/test_play_release_gate.py` valida o contrato
atual e seis regressões sintéticas: ausência de destinatário, volta de
subscribe ao tópico geral, perda da desinscrição de tópicos de
discussões, eliminação do filtro UID, eliminação da checagem de origem
por tópico e reativação indevida do broadcast no Worker.

**Limite:** auditoria estática não comprova que o Worker atualmente
implantado corresponda ao código da PR, nem que a desinscrição FCM
tenha sido completada em todos os aparelhos ou que as barreiras
distribuídas já estejam operacionais. Testar FCM individual real com
contas fictícias e o conteúdo do AAB final continua obrigatório,
e `push_block_safe_delivery` permanece não verificado.


## Token FCM: diagnóstico restrito à sessão OTA — 02/11/2026

Na variante Play, o painel avançado de notificações **não oferece**
o comando de copiar token FCM para a área de transferência do Android.
O botão permanece disponível na distribuição OTA de diagnóstico, mas
só funciona quando a conta autenticada ainda corresponde ao UID do
painel e as notificações estão habilitadas nesse aparelho. A mesma
regra é reavaliada quando a consulta assíncrona do token termina,
para evitar copiar um token após logout, troca de conta ou desativação.
Nenhum token é registrado em logs, no estado do Compose ou em mensagem
de erro.

A regra pura `mayUseFcmTokenDiagnostics` é testada na suíte JUnit
existente de `PushRegistrationDiagnosticTest`. O gate pré-assinatura
também recusa regressões que tornem o botão disponível na Play ou
retirem a checagem de sessão; os testes sintéticos ficam na suíte
Python já utilizada. Não foram alterados o cadastro FCM, a entrega
de notificações, as permissões Firestore, a chave de assinatura nem
o Worker implantado.

**Limitação:** isso protege a cópia *iniciada pelo app*; não limpa
tokens copiados anteriormente em outros aplicativos e não comprova
a exclusão do registro remoto de `pushDevices` quando o usuário
encerra a sessão sem conexão. O recebimento de mensagens `notification`
por fora do receptor e o cancelamento remoto de inscrições antigas
continuam sujeitos à homologação real antes da Play.


## Logout FCM confirmado no servidor — 02/11/2026

O logout anterior apagava o registro `pushDevices/{deviceId}` de forma
assíncrona e chamava `auth.signOut()` imediatamente. Agora o aplicativo
desliga os avisos localmente, registra uma pendência persistida por UID,
solicita a remoção e só encerra a sessão automaticamente após
**confirmação do Firestore sob a mesma conta autenticada**.
O diálogo permite **Sair sem confirmação** caso a remoção permaneça
pendente ou falhe; também oferece permanecer no app ou tentar de novo
após erro. Cancelar invalida os callbacks de saída tardios.

Enquanto o servidor não confirma a exclusão remota, novas ativações
FCM nessa conta/dispositivo são bloqueadas. A tela de Push mostra
explicitamente a pendência e oferece repetição da remoção. Quando o
titular entra novamente na mesma conta, tenta-se reconciliar a
pendência antes de reativar o cadastro. Não se apagam registros de
outra conta com sessão incorreta. Um teste JUnit acrescentado à suíte
existente verifica a condição pura da conclusão automática.

**Limites:** offline pode impedir confirmação indefinidamente; logout
explícito sem confirmação pode deixar o documento remoto até o titular
autenticar-se outra vez ou até limpeza administrativa autorizada.
A confirmação do Firestore não comprova revogação completa do token
FCM, cancelamento de todo tópico legado ou exclusão de conta. Ainda
são obrigatórios QA de rede, duas contas e tokens em aparelhos reais.
Nenhum deploy ou mudança de produção foi realizado.


## QA FCM de duas contas e rede desligada — revisão de 02/11/2026

O teste existente `tests/security/account-deletion-freeze.test.mjs`
comprova no Firestore Emulator que duas contas com o mesmo
`deviceId` não podem ler, atualizar ou apagar tokens uma da outra.
Mesmo com congelamento administrativo, o titular não consegue excluir
o registro via cliente: o executor confiável precisa reconciliar esse
estado sem relaxar as Security Rules.

O primeiro ensaio tentou deixar um `deleteDoc` pendente durante
`disableNetwork`. Esse cenário prendeu a suíte de emuladores; por
isso a revisão determinística agora comprova que um documento visto
somente em cache offline **não representa confirmação de remoção**,
reconecta antes de solicitar exclusão e exige o retorno confirmado
do servidor. O teste também assegura que a outra conta permaneça
intacta. A etapa de regras Firestore da CI recebeu limite de 8
minutos, sem criar outro workflow ou duplicar compilações.

**Cobertura não concluída:** ainda falta observar no Android físico
uma exclusão FCM enfileirada com rede desligada e alternância de
sessões. Um teste que evita o travamento da suíte não substitui essa
homologação. Não houve qualquer alteração de produção ou habilitação
das evidências de publicação.


## CI Firestore: remover fila de revisão obsoleta — 02/11/2026

O GitHub Actions manteve a antiga execução de regras Firestore
(`41537423201`) ativa depois de o SDK entrar numa operação offline
sem conclusão; os novos testes (`41538855032`) ficaram pendentes no
mesmo grupo, apesar de o cenário ter sido corrigido no código.

O workflow **existente** `selos-ci.yml` agora usa
`cancel-in-progress: true` no grupo por PR/ref: uma atualização
relevante cancela **apenas a validação anterior desse grupo**, dando
preferência ao código atualmente proposto. Mantém-se o timeout de
**8 minutos** no passo `npm test` do Firestore e a separação por
PR/ref. A mudança não cancela releases, não publica Workers, não
modifica regras reais nem dispensa o teste de segurança. O resultado
mais recente ainda precisa ser confirmado no GitHub Actions;
execuções canceladas **nunca** contam como aprovadas.


## Central administrativa: três filas com confirmação de servidor — 02/11/2026

As filas de denúncias de publicações (`reports`) e de solicitações
de selo (`badge_requests`) antes aceitavam a primeira leitura do
cache Firestore como prova de acesso administrativo. Agora usam a mesma
barreira já adotada em `user_reports`: sessão autenticada exatamente
igual ao UID da tela, snapshot confirmado pelo servidor, sem erro e
sem escritas locais pendentes. O aplicativo inclui mudanças de metadata
nos três listeners, para atualizar a tela após resposta do servidor e
remover conteúdos quando a consulta perde autoridade. Listas,
paginação e estado de erro são reiniciados no fail-closed. Não se
exibem os motivos ou identidades dos denunciantes nos avisos.

A condição pura `verifiedAdminNoticeSnapshot` é testada na suíte
JUnit existente de notificações, sem novo workflow. O filtro é defesa
em profundidade e não substitui revogação imediata no Firestore
Security Rules nem evidência operacional de moderação. Nenhum dado
real foi acessado e nenhuma alteração foi implantada.


## Revogação do papel administrativo na interface — 02/11/2026

O painel da comunidade antes ativava `isAdmin` a partir de qualquer
snapshot de `admins/{uid}`, inclusive um documento em cache sem
confirmação atual do servidor. Agora `OnlineAtrioApp` exige um
documento **existente, com `enabled=true`, recebido do servidor,
sem gravações pendentes e sob o mesmo UID autenticado**. O listener
inclui `MetadataChanges.INCLUDE` para que alterações de origem
cache/servidor também reavaliem a permissão. Falha, ausência de
documento, troca de usuário ou perda de confirmação esconde a
moderação e a revisão clerical.

A regra pura `verifiedAdminRoleSnapshot` é exercitada na suíte JUnit
já existente, ao lado da proteção das três filas administrativas
implantada anteriormente. Essa proteção evita que a interface trate
cache como autorização; a decisão final de acesso permanece nas
Security Rules do Firestore. Exige validação de revogação em
dispositivo de QA antes de considerar o controle UGC homologado.
Não houve mudança de regras publicadas, backend ou dados reais.


## Notificações pessoais após logout ou troca de conta — 02/11/2026

A verificação do executor administrativo de exclusão confirmou que o
fluxo de **QA isolado** impede remover o Auth simulado antes da
reconciliação dos dados conhecidos, das aprovações e do lease
distribuído. Isso não significa que exista um executor de produção
homologado.

Em paralelo, a Central de Notificações foi reforçada: callbacks
assíncronos de `users/{uid}/notifications` e do próprio
`badge_requests/{uid}` podem retornar depois de logout/troca de
conta. Agora verificam o UID autenticado **no instante do callback**;
caso não corresponda ao UID original, zeram a lista/aviso, removem a
paginação anterior e não apresentam conteúdo da sessão antiga.
As três filas administrativas já eram fail-closed na PR #71.

Teste unitário adicional em `NotificationModelsTest` cobre troca
bilateral, logout e UID vazio. Não há novo workflow, mudança de Rules
ou qualquer contato com produção. Continua pendente validar com
dois aparelhos/usuários e comprovar a exclusão real ponta a ponta
antes de homologar as evidências da Google Play.


## Geração de operação FCM para impedir callbacks antigos — 02/11/2026

`PushRegistry` agora persiste um contador de geração por UID no
`SharedPreferences`. Toda ativação explícita e desativação
invalida as operações de registro anteriores antes de escrever no
Firestore. As respostas assíncronas de obtenção do token, gravação
no Firestore, inscrição/desinscrição de tópicos e falha FCM
revalidam a geração, a sessão Firebase, o opt-in e a inexistência de
remoção pendente. Um callback de registro antigo não pode desligar
um opt-in mais recente, nem anunciar uma ativação depois do logout.
A confirmação do `delete()` remoto também só limpa o marcador local
se pertencer à tentativa de revogação atual.

A condição foi extraída para `mayContinueFcmRegistration`, testada
na suíte JUnit preexistente com troca de usuário, remoção pendente,
desativação local e operações com gerações distintas. A proteção
de geração é defesa local; **não prova** entrega de FCM, exclusão
efetiva de conta, serialização de serviços externos nem revogação
completa de tokens no Google. Homologação em aparelhos e aprovação
das evidências reais permanecem pendentes. Não houve deploy.


## Inventário de exclusão: paginação explicitamente verificada — 02/11/2026

A coleta somente-leitura em `cloudflare/account-deletion-audit` agora
rejeita páginas que omitem o marcador `nextPageToken`, incluem campos
desconhecidos, ou retornam um cursor falsy/malformado
(`undefined`, `false`, `0`, string vazia). **Somente `null`
explícito** encerra a paginação. O adaptador REST do Firestore
também rejeita respostas HTTP 200 com `nextPageToken` presente
porém vazio, ao invés de tratá-lo silenciosamente como ausência.

As regressões cobrem essas respostas e a listagem paginada correta de
`users/{uid}/pushDevices`, preservando isolamento entre contas.
A auditoria permanece apenas de leitura, com
`pagesComplete:false` e sem poderes de exclusão; esses testes não
autorizam a publicação. Executados no workflow AAB Play já existente
(sem criar CI adicional), sem credenciais ou contato com produção.


## Inventário REST de subcoleções órfãs — 02/11/2026

A auditoria `cloudflare/account-deletion-audit` ganhou descoberta
somente-leitura dos **IDs de subcoleções em todos os documentos raiz
pertencentes ao usuário** (incluindo pais ausentes, cujos filhos
podem persistir). Usa `documents/{parent}:listCollectionIds`, RPC de
**leitura** do Firestore REST que utiliza HTTP POST, com OAuth do
backend de auditoria, jamais credenciais do navegador. O resultado
é paginado com cursor estrito, limite de páginas, IDs validados e
falha se a resposta for incompleta, repetida ou contiver campos
desconhecidos. A API não faz `commit`, `batchWrite` ou exclusões.

`inventoryOwnedDocuments` agora usa a descoberta quando disponível
para marcar `hasUnknownCollections` e listar internamente nomes de
subcoleções não previstas. Se o adaptador não oferecer a nova operação,
**mantém `hasUnknownCollections:true`**. Mesmo com topologia conhecida,
`pagesComplete:false` e `safeToExecute:false` permanecem como
bloqueios: ainda faltam dados relacionais, mídia, retenção, IAM e
processamento real. Os testes exercitam um pai ausente com subcoleções
órfãs, IDs inesperados e cursor irregular sem acessar o Firebase real.


**Precisão da cobertura:** a descoberta acima só audita os nomes de
subcoleções **diretamente sob cada documento raiz conhecido**, não os
netos ou níveis profundos sob documentos filhos. Por isso a auditoria
mantém obrigatoriamente `hasUnknownCollections:true`, mesmo quando
todos os nomes descobertos no primeiro nível pertencem à allowlist.
`hasUnknownDirectSubcollections` e
`directRootSubcollectionDiscoveryComplete` permitem inspecionar a
cobertura parcial sem apresentar ausência global de órfãos. A
autorização de exclusão segue bloqueada.


## Auditoria recursiva de descendentes Firestore próprios — 03/11/2026

A partir da PR #71, o adaptador REST de auditoria pode **ler**, sob
`OWNED_ROOTS/{uid}`, nomes de coleções e páginas de documentos
descendentes, recusando qualquer caminho fora do UID autorizado. A
listagem usa `showMissing=true` na API Firestore, para descobrir
pais sem documento que ainda possuem subcoleções órfãs.

`inventoryOwnedDocuments` percorre essas coleções por fila, com
paginação/cursor estritos, limites de profundidade, total de documentos
e de coleções. Descobre caminhos até o limite e **falha fechado**
diante de profundidade excessiva, dados de outra conta ou paginação
ambígua. Uma leitura `listCollectionIds` usa POST por especificação
do REST do Firestore, mas não faz escritas. Adaptadores legados sem
essa capacidade seguem no inventário incompleto.

`ownedNestedTreeScanComplete` identifica apenas a **varredura dos
descendentes dentro de raízes próprias conhecidas**; nunca comprova
todas as coleções globais ou relacionais. `pagesComplete:false`,
`hasUnknownCollections:true`, `safeToExecute:false` e os bloqueios
de IAM/retencão/Cloudinary/FCM/Auth permanecem. Testes sintéticos
cobrem netos órfãos, sessão de outra conta, cursor inválido e excesso
de profundidade. Nenhuma conta ou dado real foi consultado.


## Prompt 25 — barreira Admin SDK para filhos órfãos antes de Auth (03/11/2026)

A QA com Admin SDK real conectado **somente** aos emuladores Firebase
Auth/Firestore ganhou auditoria independente `qa-admin-owned-tree-audit.mjs`.
Ela varre, com `listCollections()` e `listDocuments()`, as árvores sob
`OWNED_ROOTS/{uid}`, inclusive documentos-pai inexistentes com descendentes.
Imposta allowlist de UID sintético exato, limites de profundidade/quantidade,
checagens de caminho e rejeição total de credenciais ou URLs reais.
Não possui delete, write, API pública nem deployment.

Quando esse adaptador está presente no executor administrativo de QA,
`remove_auth_stub_last` faz a varredura depois de verificação de mídia,
D1 e retenção, **repetindo** a inspeção após a reconciliação assíncrona
na última barreira antes do delete no Auth Emulator. O checkpoint final
também a exige. Fixture E2E cria um neto órfão da conta Alice e dados
separados de Bob; exige rejeição da remoção Auth até retirar o neto de
Alice, sem tocar na conta Bob. Teste executado no workflow
`selos-ci.yml` preexistente, sem criar pipeline novo.

Esta verificação cobre somente as raízes de propriedade conhecidas;
não substitui varredura relacional global, revisão LGPD, retenção,
Workers em produção, autorização real ou teste manual. O executor
continua de QA e `releaseAuthorized:false`.


## Prompt 26 — auditoria profunda obrigatória para Auth externo de QA (03/11/2026)

A varredura de descendentes criada no prompt 25 era **opcional**:
se `external.nested` fosse omitido, o executor de QA ainda poderia
alcançar `remove_auth_stub_last`. Agora todo executor de QA com
adaptadores `external` (incluindo Auth Emulator REST/Admin SDK)
é rejeitado no construtor até receber auditoria independente
`nested.assertEmpty`. Preflight, última revalidação antes de Auth
e checkpoint final exigem sempre esse adaptador.

Os dois cenários E2E existentes foram reforçados para usar a varredura
Admin SDK de subcoleções próprias e verificar que a **omissão** bloqueia
o executor sem apagar a identidade. O workflow `selos-ci.yml` retira
`FIREBASE_CONFIG` apenas do subprocesso QA de Auth REST para permitir
Firebase Admin local sem credenciais; mantém projeto fictício, somente
localhost e rejeição de chaves reais. O serviço continua de QA,
sem deploy e sem autorizar eliminação de usuários reais.


## Prompt 29 — proteção de leitura administrativa contra cache (03/11/2026)

As filas de moderação `reports` e de denúncias de usuários `user_reports`
agora aplicam a mesma condição de snapshot confiável já testada pelas
notificações administrativas: UID de sessão correspondente, resposta
confirmada pelo servidor, sem erro, cache ou escritas pendentes.
`reports` passa a escutar mudanças de metadata para revogar dados
visíveis imediatamente quando a origem vira cache. No painel paginado
de `user_reports`, falha de servidor ou sessão limpa também páginas
anteriores, cursor, seleção e justificativa temporária; não mantém
motivos/identificadores privados na interface após perda de autoridade.

Reutilizado `verifiedAdminNoticeSnapshot` e os testes JUnit existentes,
sem nova suíte, workflow ou build manual. A autorização definitiva de
leitura continua nas Firestore Security Rules; o reforço é de interface.
Nenhum dado ou serviço real foi alterado e nada libera assinatura/Play.


## Otimização de emuladores em revisões incrementais — 03/11/2026

A PR #71 já confirmou onze verificações aprovadas no commit anterior.
Os filtros `pull_request.paths` do GitHub avaliam a PR acumulada,
por isso revisões apenas de documentação ou fichas offline podem
reativar emuladores demorados, mesmo sem alteração de aplicativo.

O classificador `scripts/play_ci_heavy_scope.py` e sua suíte Python
usam uma allowlist **fechada**: somente `docs/**`, páginas estáticas
de atendimento `cloudflare/account-deletion-support/**` e quatro
módulos offline de preparação de revisão de moderação podem dispensar
testes caros de emuladores, e apenas em sincronização de PR com histórico
linear verificável. **O portal autenticado de exclusão NÃO entra nessa
exceção**, tampouco Firebase Rules, app, Workers, backend de exclusão,
inventário compartilhado ou qualquer caminho desconhecido.

Os workflows existentes de Firestore/selos, Guardião V2 no Android e
Guardião V2 integrado passaram a consultar esse escopo antes de instalar
Java, Node, SDK Android ou emuladores. Em uma primeira PR, push na
`main`, execução manual, rebase, diff vazio, erro de leitura,
mudança no próprio classificador ou alteração de código relevante,
**continuam a executar os testes completos**. Os jobs registram
explicitamente quando os emuladores não foram executados: status verde
não implica cobertura nova do emulador.

O workflow Play continua executando testes de retenção e exclusão,
auditoria de privacidade/UGC, verificação de configuração e gates de
release; agora também testa a política de escopo. A auditoria de
segredos do repositório permanece independente. Antes de qualquer
assinatura/submissão é indispensável executar a homologação completa.
Não foram alterados produção, assinatura, Play Console, backups ou
permissões de dados.
