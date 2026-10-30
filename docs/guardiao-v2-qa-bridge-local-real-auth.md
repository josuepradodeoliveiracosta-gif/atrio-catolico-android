# Teste QA real com token Firebase usando o Worker **local**, via Termux

**Objetivo:** finalizar a prova de que a ponte `qa-user-firestore-bridge.js` recebe o ID token Firebase Auth do QA e classifica **somente** a publicação sintética `posts/qa_post_1`. O Worker QA remoto continua **desligado** (`GUARDIAN_V2_QA_FIRESTORE_BRIDGE=false`); não altera o Firebase oficial, não cria credenciais de serviço, não autoriza produção, não executa moderação.

## Executar no Termux

```bash
cd ~/atrio-guardiao-qa-firebase/repo
git pull --ff-only origin feature/guardiao-autonomo-20261029
python scripts/qa-auth-termux.py --test --bridge-local
```

O script já usado no QA confere o `appId`, `projectId` e a API key do **Web App QA** via `firebase apps:sdkconfig`; então cria uma conta temporária, entra com e-mail/senha, nega a leitura anônima, valida a leitura autenticada direta, e **antes de excluir a conta** executa o arquivo `scripts/qa-bridge-auth-local.mjs`. O token é passado ao Node **somente por stdin**, sem argumento de processo, variável de ambiente, arquivo, output ou telemetria. Em caso de erro, a conta continua sendo excluída em `finally`. O teste exige Node 22+.

O script Node importa **o código real** `qaFixtureRequest`, com as flags QA ativadas **apenas em memória no Termux**; verifica o URL, método GET e cabeçalho do único destino literal Firestore QA. O servidor Firebase verifica a assinatura do ID token e aplica as Security Rules. A resposta não mostra token, UID, e-mail, texto da publicação ou dados arbitrários.

**Limitação importante:** bindings da Cloudflare Rate Limiting e do banco D1 **são simulados** somente dentro deste teste local; os mecanismos reais foram avaliados separadamente no Worker QA e na API D1. Esse teste NÃO valida o Worker remoto com a ponte ativada, e NÃO autoriza liberar a flag. Apenas uma chamada GET extra ao Firestore QA é feita enquanto a conta temporária existe, sem escrita de moderação.

Resultado esperado:
- `QA_PROJECT_VERIFIED: atrio-catolico-qa-v2`
- `QA_EMAIL_PASSWORD_LOGIN: OK`
- `QA_ANONYMOUS_READ: BLOCKED`
- `QA_AUTHENTICATED_FIRESTORE_RULES: OK`
- `QA_BRIDGE_LOCAL_PASS: qa_fixture_clear` (ou outro resultado *qa_fixture_* permitido se o documento falso for alterado)
- `QA_TEST_RESULT: PASS`
- `QA_TEST_ACCOUNT_REMOVED: YES`

Se falhar, **não repetir automaticamente** nem tentar abrir a ponte pública; verificar apenas códigos fixos e a exclusão. `python scripts/qa-auth-termux.py` continua somente pré-verificação sem criar conta; `--bridge-local` sozinho é bloqueado.

CI independente sem Firebase ou secrets: `.github/workflows/guardiao-qa-termux.yml`, testes Python e Node em memória. A PR #44 permanece draft; `main` e APK oficial intocados.
