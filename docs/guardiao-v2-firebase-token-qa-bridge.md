# Guardião V2 — conexão sem chave Firebase, limitada a fixture QA

**Pré-lançamento, sem usuários reais.** Esta fase não liga moderação em produção e não transforma o cron QA em um scanner 24/7. O código está apenas na PR #44 da branch `feature/guardiao-autonomo-20261029`.

## Experimento seguro implementado

A Cloud Firestore REST API suporta dois tipos de token:
- ID token do **Firebase Authentication**: as **Firestore Security Rules** determinam quais documentos o portador pode acessar.
- OAuth token de **conta de serviço**: IAM decide o acesso e pode contornar as regras do cliente.

Fonte oficial: https://firebase.google.com/docs/firestore/use-rest-api

O módulo `cloudflare/guardian-worker/src/qa-user-firestore-bridge.js` utiliza **exclusivamente o primeiro caminho**. A rota de laboratório `POST /qa/firebase-fixture`:

1. Falha com HTTP 503, por padrão, pois `GUARDIAN_V2_QA_FIRESTORE_BRIDGE=false`.
2. Quando habilitada **num QA autorizado**, exige `TEST_MODE=true`, `ENABLED=false`, `HOLD_ENABLED=false`, `QA_SHADOW_READS=false`, `QA_AUTO_DISPATCH=false`, `QA_DISPATCH_READY=false`, `QA_READER_PROJECT=atrio-catolico-qa-v2`, **nenhum JSON de service account** e **nenhum projeto de produção** nas variáveis de backend.
3. Recebe um único cabeçalho `Authorization: Bearer <Firebase ID token>` de um usuário **do Firebase Auth do projeto QA**. O Worker **não confia em claims JWT não verificados localmente**: ele repassa o token para a API oficial Firestore que valida o token e **aplica as próprias regras de segurança**. Um token Firebase oficial do projeto `atrio-catolico` não autoriza um usuário no projeto `atrio-catolico-qa-v2`.
4. Faz, no máximo, **um GET por requisição** no endereço **literal e imutável** `projects/atrio-catolico-qa-v2/databases/(default)/documents/posts/qa_post_1`. Não aceita ID, projeto, coleção ou campo enviados pelo cliente; nem JSON ou corpo no POST. Esse endpoint Cloudflare não chama endpoints de escrita.
5. Só classifica quando o Firestore retorna exatamente esse documento com `qaFixture=true`, campos de texto válidos e limites de tamanho. A resposta contém **apenas** `qa_fixture_clear`, `qa_fixture_review` ou `qa_fixture_warn`, nunca texto, UID, ID de documento, cabeçalho de autenticação, dados de perfil ou valores arbitrários retornados pelo Firebase.
6. Em credenciais inválidas, regras negadas, documento inexistente, API indisponível ou formato inesperado, retorna erro genérico **sem bypass**. É apenas leitura e não atualiza `guardian_cases`, `guardian_runtime`, `guardiao_quarantine` ou outros dados.

## Atenção: o que isto NÃO faz

- **Não é um serviço de moderação 24/7.** O cron continua executando apenas os cinco exemplos sintéticos da política; esta rota exigiria um usuário QA autenticado fazendo a requisição.
- **Não é login administrativo** nem substitui autenticação do servidor. As permissões continuam sendo as do próprio usuário Firebase sob Security Rules.
- **Não verifica revogação de token de maneira adicional** (depende do Firebase na consulta).
- A rota deve ficar **DESLIGADA** até confirmar uma conta de teste criada **no Auth do Firebase QA**, regras QA apropriadas e limites de chamadas. A flag `false` evita consumo de reads por endpoint público.
- Um usuário legítimo pode gerar muitas solicitações, consumindo a quota gratuita do Firestore; não ativar a rota para tráfego externo sem rate limit e verificação de uso. O Worker não dispõe ainda de limite persistente por UID.
- Um token do Firebase oficial **não pode** ser reaproveitado silenciosamente para o projeto QA. Criar contas/fixture somente com autorização explícita e sem importar contas reais.
- Não adicionar segredo de conta de serviço no Worker QA para contornar Firestore Rules.

## Testes e implantação

`src/qa-user-firestore-bridge.test.js` cobre bloqueio de projeto e flags, token inválido, método/corpo indevido, consulta a um único documento, não vazamento de dados, autorização negada, erro de rede e tentativa de uso administrativo.

`wrangler.qa.toml` mantém:
```toml
GUARDIAN_V2_QA_FIRESTORE_BRIDGE = "false"
GUARDIAN_V2_QA_READER_PROJECT = "atrio-catolico-qa-v2"
```

**Não publicar a rota remotamente nesta etapa até que a suíte completa passe.** Um deploy QA posterior deverá preservar todas as flags de segurança, sem ativar essa rota.

## Próximo bloqueador real

Para o Guardião aplicar moderação permanente, é preciso uma identidade de servidor com permissões mínimas de leitura e escrita sobre **casos/avisos/quarentena**, sob custo gratuito e quotas conhecidas. O token de usuário não autoriza escrever dados administrativos, corretamente. O WIF atual do GitHub é **somente leitura**. Qualquer solução para execução contínua no projeto real exigirá desenho de identidade, execução de QA e autorização específica antes de liberar qualquer sanção.
