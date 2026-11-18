# Guardião V2 — porta Firestore de homologação (sem deploy)

**14/11/2026.** Complemento **dependente da PR #290**, em branch própria. Não modifica a PR-base, `main`, IAM, WIF, Firestore, Cloudflare, credenciais, cron, contas reais, dados, APK ou backups.

## O que foi preparado

- `scripts/guardian_v2_qa_firestore_port.py` associa a verificação de identidade por **Google ID token** já existente na PR #290 (`authorize_intent`) a uma **porta de operações Firestore**, sem criar endpoint HTTP ou serviço.
- `QaFirestoreScope` exige projeto QA distinto de `atrio-catolico` e das fixtures reservadas pela PR #290; as contas de triagem e ativação são diferentes. A porta confere também `client.project` e o banco do cliente.
- Apenas a identidade **triage** pode executar `read_policy` e `propose_case`. A rota `enable_nonpunitive` permanece **não implementada** nesta porta, pois falta autorização independente verificável.
- A leitura `read_policy` devolve somente o booleano de política não punitiva; não expõe configurações completas.
- `propose_case` usa o contrato estrito de payload existente e a API `google.cloud.firestore.transactional` / `client.transaction()` para preparar os quatro efeitos **em uma transação**: caso, auditoria, aviso genérico e contador de quota por dia UTC.
- A função transacional relê política, origem, caso, auditoria, aviso e quota **antes** de enfileirar qualquer escrita. Recusa política parada/hold, dono ou revisão divergente (incluindo nanossegundos), registros pré-existentes e quota excedida. Não possui operação de exclusão, bloqueio, punição ou manutenção genérica.
- As leituras e escritas são feitas por conta de **serviço do mediador** a ser definida; não há envio FCM, notificação externa ou outro efeito fora da transação.
- Resultados `QA_TRANSACTION_DENIED` e `QA_BACKEND_UNAVAILABLE` são distintos; uma falha de rede, de SDK ou de commit **não é prova de negação IAM**.

## Verificações e limites

Os **16 testes** `scripts/test_guardian_v2_qa_firestore_port.py` usam um **cliente e transação falsos** (in-memory), mais uma decisão de identidade simulada. Exercitam o formato de chamadas ao SDK, reads-before-writes, replay, quota, validações negativas, falha de commit e ausência de writes em um commit artificialmente falho.

**Não comprovam:** assinatura de token Google real, invocação Cloud Run, autorização IAM externa, atomicidade distribuída do Firestore, retries efetivos do SDK, ausência de efeitos após timeout remoto, comportamento do Emulator, autenticação de approver, custos nem implantação. O módulo usa import tardio; **não declara dependência Google instalada no repositório** e não possui entrypoint de execução por HTTP.

Comandos locais e no CI de segurança existente:

```sh
python3 -m unittest scripts.test_guardian_v2_qa_firestore_port -v
```

## IAM e ambiente — portões obrigatórios antes de testar remotamente

1. **Fundador e Agente 4 (Segurança):** comprovar por evidências privadas o ID real de projeto Firebase/Google QA, sua inexistência como produção, o banco, o faturamento/custo permitido e os meios de reversão. O identificador QA do teste é **sintético**: `atrio-catolico-qa` **não foi confirmado como projeto existente**.
2. **Identidades separadas:** criar ou comprovar na QA os principals `triage`, `activation` e **mediator-runtime**, sem credenciais JSON de longo prazo. WIF com restrições exatas de repositório, branch/workflow e ambiente QA; tokens de **ID** Google-signed com `includeEmail=true` e audiência específica da URL privada Cloud Run.
3. **Privilégio mínimo:** triage e activation devem poder **somente invocar** as operações privadas autorizadas no mediador e **não** ter roles Datastore/Firestore. A identidade do mediador, isolada e inspecionada, é a única com acesso ao Firestore do projeto QA. Firestore IAM sozinho não implementa permissão por documento: a allowlist de caminhos e operações deve residir no mediador.
4. **Servidor privado futuro:** exigir autenticação nativa do Cloud Run + verificação assinada no aplicativo, cabeçalhos não ambíguos, separação de chamadas, aprovação humana externa não fornecida pelo payload, timeout, limites de custo e observabilidade sanitizada. Não usar `X-Serverless-Authorization` como JWT verificável no contêiner.
5. **Integração real autorizada depois:** fixar dependências `google-auth` e `google-cloud-firestore`; testar em projeto/database QA reais, primeiro leitura de política, depois escrita com **dados sintéticos** e duas instâncias para replay/quota/CAS, rollback e prova de negação IAM autenticada. Consolidar as 16 provas em `guardian_v2_qa_evidence_gate.py` da PR #290.
6. **Revisão/integração:** Agente 5 valida CI e Emulator/QA, Agente 4 revisa IAM/risco, Agente 7 revisa integração. O fundador mantém aprovação de qualquer recurso pago, deploy QA e migração de produção.

## Resultado e continuidade

**Estado:** porta de SDK preparada e ensaiada offline; **QA real = NO_GO**, produção = **NO_GO**. O avanço **não conclui novo marco** do plano de 6 marcos. A contagem permanece 1/6 (17%) até que os critérios reais de autenticação, IAM e transação no ambiente homologado sejam demonstrados.

**Próxima ação técnica segura:** definir com revisão independente o contrato do adaptador HTTP privado e a procedência verificável da aprovação humana, sem conceder permissões antes de comprovar a segregação IAM.

Referências oficiais:
- https://docs.cloud.google.com/run/docs/authenticating/service-to-service
- https://docs.cloud.google.com/docs/authentication/token-types
- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://docs.cloud.google.com/python/docs/reference/firestore/latest/google.cloud.firestore_v1.transaction
