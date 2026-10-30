# Guardião QA: teste remoto autenticado pelo Termux (preparado, NÃO ativado)

## Escopo
Este modo é destinado a **uma única execução humana supervisionada**, exclusivamente com `atrio-catolico-qa-v2`. A Cloudflare permanece com `GUARDIAN_V2_QA_FIRESTORE_BRIDGE=false` por padrão, e as regras/contas Firebase oficiais não são tocadas. O teste só está pronto no código: **não foi executado com token válido na Cloudflare**.

O CLI `scripts/qa-auth-termux.py` tem um modo `--test --bridge-remote` que:
1. Verifica nome, App ID e API key do Web App Firebase QA via Firebase CLI, e o projeto informado pela API Authentication;
2. Antes de pedir e-mail ou senha, faz **POST anônimo sem dados** para a URL fixa `https://atrio-guardian-v2-qa.atrio-catolico.workers.dev/qa/firebase-fixture`. Exige exatamente `401 unauthorized`. Se vir `503 qa_bridge_disabled` ou outro resultado, para sem criar conta;
3. Somente depois disso cria uma conta temporária, verifica login, acesso anônimo negado e leitura Firestore QA direta;
4. Usa o ID token transitório dessa conta em **um único POST** ao Worker QA, sem corpo. Desativa redirecionamentos por código; jamais segue URL externa com Bearer. Aceita apenas `200 qa_fixture_clear/review/warn` da fixture literal, sem revelar texto, UID, token ou senha;
5. Exclui a conta no bloco `finally` até quando o teste falha. Se houver `QA_TEST_ACCOUNT_CLEANUP_REQUIRED`, exige revisão humana no Firebase QA.

### Comando preparado (apenas quando a ponte QA estiver explicitamente autorizada e ativada)
```bash
cd ~/atrio-guardiao-qa-firebase/repo
git pull --ff-only origin feature/guardiao-autonomo-20261029
python scripts/qa-auth-termux.py --test --bridge-remote
```

**Não execute o comando enquanto a ponte estiver desligada**: ele retornará `QA_BRIDGE_REMOTE_DISABLED`, sem criação de conta. Não exponha prints contendo email, token ou credenciais. Não execute `wrangler deploy` nem altere flags para contornar um bloqueio operacional ou de segurança. O Worker QA remoto somente pode ser habilitado em janela supervisionada, com rollback confirmado, orçamento e limitadores reais revisados. O resultado positivo **não** libera produção.

### Limitações
- A autorização de testes é anterior à ativação oficial; a moderação segue false.
- A autorização do usuário para QA temporário não equivale a aprovação de acesso OAuth/IAM no Firebase oficial.
- O teste realiza no máximo uma chamada autenticada via Worker por conta; o preflight anônimo não reserva D1.
- Cloudflare Rate Limiting é aproximado por localidade; o D1 possui limite diário de 12 consultas.
- A conta temporária é criada pelo Firebase QA apenas se a rota autenticada já estiver pronta.
- A remoção é tentada e registrada, mas falhas devem ser resolvidas manualmente.

CI offline: `.github/workflows/guardiao-qa-termux.yml`. Nenhum teste de CI armazena token real ou aciona o Worker com credenciais válidas.
