# Guardião V2 — portão QA para tokens de identidade Google (código não implantado)

**14/11/2026 — continuação da PR #290.** Preparação da próxima fronteira técnica, sem habilitar infraestrutura, criar contas, obter tokens, conectar Firebase ou conceder acesso ao Firestore.

## Problema

A PR #289 apenas simula identidades sintéticas; seus 21 testes não autenticam ninguém. A triagem e a ativação de produção compartilham a identidade WIF de escrita. Antes da homologação externa autorizada é necessário preparar **verificação de identidade distinta por operação** sem confiar em `role`, email ou workflow presentes no corpo da requisição.

## Entrega concreta e limites

- `scripts/guardian_v2_qa_idtoken_gate.py` contém `QaIdentityConfig`, `authorize_intent` e `verify_google_token`.
- Exige projeto de QA distinto dos identificadores proibidos, audiência HTTPS de `.run.app`, e duas contas de serviço distintas pertencentes ao mesmo projeto QA.
- Aceita apenas `Authorization: Bearer <token>` sem múltiplos cabeçalhos ou formatos livres; não confia em `X-Caller-Email`, `role`, `workflow` ou `service_account` fornecidos por um cliente.
- O verificador real usa `google.oauth2.id_token.verify_oauth2_token` com audiência explícita, que confere assinatura, expiração e emissor via certificados Google; a aplicação confere novamente `iss`, `aud`, `email_verified`, `sub`, `azp`, vigência curta, conta esperada e operação permitida. **No CI**, um verificador sintético injetado simula o retorno criptográfico; portanto os testes não atestam nenhum token verdadeiro.
- Uma identidade autenticada de TRIAGEM somente pode pedir `read_policy` ou `propose_case`; a de ATIVAÇÃO somente `enable_nonpunitive`. Estas são **intenções**: ainda faltam validação do envelope, aprovação humana vinculada à operação, política, transação Firestore, CAS e verificação externa de IAM.
- Toda resposta inclui `production_authorized: false`. Resultado positivo `QA_VERIFIED_IDENTITY_INTENT_ONLY` **não executa transação, não aprova produção, não comprova isolamento IAM e não é endpoint HTTP**.
- Testes offline `scripts/test_guardian_v2_qa_idtoken_gate.py` verificam identidades cruzadas, contas de produção, emissor, público, tempo, identidade do token, formato do cabeçalho, erros e falha fechada. Nenhum token real ou serviço é usado.

## Adaptações necessárias antes de QUALQUER homologação conectada

1. Confirmar com o proprietário **projeto/banco de homologação efetivamente separado**, identidades, custo, aprovação, rollback e regra de não acesso direto ao Firestore pelos chamadores. O programa recusa o projeto produtivo por nome, mas **não consegue provar que um projeto não é produção** só analisando um texto.
2. Avaliar e fixar a versão de `google-auth` como dependência do serviço QA e fornecer ambiente de execução privado. O módulo não importa a biblioteca até que `verify_google_token` seja usado; CI roda com biblioteca padrão e dublês.
3. Definir invocação autenticada via WIF do GitHub, token de **ID** (não access token), audiência exata da URL do serviço e `includeEmail: true` ao emitir token pelo IAM Credentials API. O Cloud Run deve exigir autenticação e apenas chamadores permitidos em `roles/run.invoker`; não substituir verificação de token pela decodificação sem assinatura.
4. **Não usar `X-Serverless-Authorization` como fonte de JWT no contêiner:** Cloud Run pode retirar a assinatura desse cabeçalho. O futuro adaptador de aplicação precisa preservar um token validável no cabeçalho `Authorization` e confirmar que o Cloud Run realmente fez sua checagem de entrada.
5. Criar adaptador HTTP e transações **apenas após desenho aprovado**. O adaptador deverá usar o verificador real, sem opção de sobrescrever o verificador com dublê ou aceitar principal fornecido no payload, e limitar entrada a intenções do contrato da PR #288.
6. Recolher provas externas **autenticadas e independentes** dos 16 cenários da PR #290; não converter testes in-memory em evidência IAM. Além disso, testar concorrência entre instâncias, quota e CAS do Firestore real.
7. Bloquear migração de produção até rever logs, negações, IAM herdado e rollback. Mudar cron, conta produtiva ou `main` exige autorização própria.

## Validação local / Termux (somente offline)

```bash
python3 -m unittest scripts.test_guardian_v2_qa_idtoken_gate -v
python3 -m unittest scripts.test_guardian_v2_qa_evidence_gate -v
```

Esses testes **não exigem Google Cloud, Firebase, Cloudflare, pacote pago ou secrets**; executar no GitHub Actions existente é suficiente neste passo.

## Referências técnicas oficiais

- Cloud Run: https://docs.cloud.google.com/run/docs/authenticating/service-to-service
- Tokens de ID: https://docs.cloud.google.com/docs/authentication/token-types
- Biblioteca Python: https://googleapis.dev/python/google-auth/latest/reference/google.oauth2.id_token.html
- Workload Identity Federation: https://docs.cloud.google.com/iam/docs/workload-identity-federation

**Estado desta entrega:** código de autenticação/roteamento preparado, sem serviço implantado e sem prova de credenciais IAM ou conexões reais. PR mantida em rascunho; sem merge não autorizado.
