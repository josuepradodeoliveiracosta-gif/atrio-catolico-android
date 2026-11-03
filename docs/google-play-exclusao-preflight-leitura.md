# Átrio Católico — inspeção operacional de fontes Firestore (somente leitura)

**PR #71 · 03/11/2026 · NÃO IMPLANTAR COMO SERVIÇO PÚBLICO.**
A fase de exclusão operacional continua **não homologada**.

## O que foi integrado

`operational-read-preflight.js` agora reúne duas implementações já existentes:
`firestore-read-adapter.js` e `relational-firestore-read-adapter.js`.
Com uma identidade administrativa **autenticada externamente** e um token
OAuth do backend limitado por IAM, o módulo consegue:

- Confirmar a solicitação vigente diretamente no documento
  `account_deletion_requests/{uid}`, no projeto Firestore configurado.
- Inspecionar todas as raízes de dados associados ao UID, descobrir
  subcoleções, inclusive pais ausentes, e percorrer a árvore própria com
  limite de profundidade e paginação estrita.
- Consultar referências por identificadores em publicações, respostas,
  notificações, denúncias e registros do Guardião, preservando os casos
  que exigem revisão individual e direitos de terceiros.
- Retornar **somente contagens e bloqueios gerais**, sem expor UIDs,
  caminhos de documentos, credenciais, conteúdo ou denúncias.

A implementação usa **GET**, `:listCollectionIds` e `:runQuery`;
os dois últimos são operações de leitura da API Firestore, embora usem
HTTP POST. Nenhum `:commit`, `:batchWrite`, `deleteUser`, Cloudinary
destroy ou D1 mutável pode ser invocado por esse módulo.

## Integração segura e limites

O módulo não possui endpoint HTTP, script CLI de produção, agendamento,
credenciais ou função para obter tokens; nada é implantado ou executado
em dados reais nesta etapa. Antes de conectá-lo a uma infraestrutura
operacional, um serviço privado deverá autenticar e autorizar o
operador, obter um token IAM somente-leitura e prover o callback
`assertAuthorizedRead`, revalidado após as consultas principais.
**Fornecer um callback não é evidência de identidade**, apenas permite
integrar mais tarde um mecanismo de controle real.

As buscas são de momentos diferentes, **não são um snapshot
transacional**. Também faltam inventários autenticados de Auth,
Cloudinary, D1 Avatar, D1 Push, FCM, referências legadas e decisões
jurídicas. Uma ausência no inventário conhecido **não prova** exclusão
global. Por isso o relatório mantém permanentemente
`allAccountDataDiscovered:false`,
`destructiveOperationsEnabled:false`,
`accountDeletionAuthorized:false` e
`googlePlayReleaseAuthorized:false`.

Não utilizar a saída como comprovante de exclusão nem registrar
`verified:true` nos manifestos da Play. A preparação da fase
destrutiva dependerá de IAM e identidade reais, aprovação jurídica de
retenção, coordenação de todos os escritores, processamento por etapas
idempotentes e reconciliação final independente.

## Verificação

Os testes `operational-read-preflight.test.js` utilizam um transporte
Firestore falso e conferem escopos exatos, bloqueio de pedido inválido,
perda de autorização, subcoleções inesperadas, falhas de consulta e
ausência de quaisquer chamadas destrutivas. São incluídos na suíte Node
Play já existente, sem novo workflow ou recompilação Android.


## Verificação contínua de autorização e pedido imutável — 03/11/2026

O diagnóstico administrativo de leitura agora invoca
`assertAuthorizedRead` **antes e depois de cada requisição remota**,
não apenas entre fases maiores de inventário. Se a autorização do
operador for revogada durante uma varredura paginada ou durante uma
resposta de rede, a rotina interrompe a leitura, não consulta a
próxima página e não retorna um resumo obtido com a sessão revogada.

Após consultar todas as fontes Firestore implementadas, a rotina
também **relê o pedido original** e exige a mesma origem e data da
solicitação observadas no início. Alteração de status, substituição
administrativa do pedido ou erro de leitura bloqueia a conclusão
do diagnóstico. A verificação não torna as leituras um snapshot
transacional; outras coleções ainda podem mudar entre páginas.

Os testes no workflow Play existente incluem perda de autorização
entre as etapas de uma leitura, perda durante a leitura de subcoleções
e substituição do pedido ao final. O resumo não carrega dados privados
e continua declarando `operatorIdentityIndependentlyVerified:false`,
`accountDeletionAuthorized:false` e
`googlePlayReleaseAuthorized:false`.

**Dependência externa:** `assertAuthorizedRead` continua sendo um
callback de infraestrutura confiável; não é uma implementação de
autenticação real de operador. Um backend privado com IAM mínimo,
validação de sessão e registro auditável será necessário antes de
consultar dados de produção. Nenhum deploy ou exclusão foi efetuado.


## Identificação do fundador antes das leituras (03/11/2026)

A PR #71 inclui agora `founder-admin-read-gate.js`, uma camada
reutilizável para o **futuro backend privado** de inspeção de pedidos.
O módulo utiliza a interface do Firebase Admin SDK, fornecida pelo
servidor, para chamar `verifyIdToken(token, true)` e exigir validação
criptográfica do token **com checagem de revogação**. Compara os
campos `aud`, `iss`, `sub`, `uid`, `iat`, `auth_time` e `exp`
ao projeto Firebase autorizado; verifica se o usuário ainda está ativo.

Em seguida, consulta explicitamente, via Firebase Admin Firestore,
`admins/{uid}`, `app_config/founder` e
`account_deletion_freeze/{uid}`. O acesso exige o administrador ativo,
o fundador correspondente e ausência de congelamento. Revogação de
token, troca de fundador, remoção do papel, bloqueio da conta, falhas
de IAM ou expiração do token **interrompem o diagnóstico**.

A função `inspectFounderDeletionReadSources` já compõe essa
verificação com o inventário `inspectOperationalDeletionReadSources`,
que revalida o acesso antes/depois de cada chamada remota. Os testes
de Node usam duas interfaces administrativas falsas, sem segredos,
para verificar recusas e perda de acesso durante uma consulta; passam
pelo mesmo workflow Play existente.

**Importante:** o arquivo não contém servidor HTTP, credenciais,
inicialização automática do Firebase Admin, rota pública ou deploy.
Os testes de identidade usam mocks, **não** comprovam um login real
Firebase nem configuração de IAM em produção. O token OAuth de leitura
Firestore é independente do token de identidade e precisa ser emitido
por servidor com permissões mínimas. Nenhuma decisão de retenção,
conciliação entre serviços, exclusão efetiva ou publicação é habilitada.
