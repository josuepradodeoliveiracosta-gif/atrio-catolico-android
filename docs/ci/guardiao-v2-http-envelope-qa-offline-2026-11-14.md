# Guardião V2 — adaptador de envelope de requisição QA, somente offline

**14/11/2026.** Complemento incremental da PR #290, cujo gate de identidade ainda é um contrato pré-deploy. O objetivo é testar, sem Google Cloud ou custo, o que um adaptador privado deverá rejeitar ao receber requisições HTTP. **Este arquivo NÃO é um servidor, API, rota implantada, autenticação externa comprovada nem autorização de escrita.**

## Implementação e critérios

`scripts/guardian_v2_qa_http_envelope.py` oferece apenas `inspect_qa_http_envelope`, uma função Python que recebe um envelope sintético como dados e retorna `SIMULATED_HTTP_DENY` ou `SIMULATED_HTTP_ENVELOPE_ACCEPTED_NO_WRITE`, sempre com `production_authorized: false`.

- Somente `POST` para três caminhos exatos: `/qa/v1/read-policy`, `/qa/v1/propose-case`, `/qa/v1/enable-nonpunitive`. Não existe `commit`, `PATCH`, `delete` ou endpoint genérico.
- Cabeçalhos chegam como **lista de pares** para detectar duplicidade/capitalização ambígua de `Authorization` e `Content-Type`; rejeitam cabeçalhos falsos de principal, aprovação e `X-Serverless-Authorization`. `Content-Type` deve ser exatamente `application/json`.
- O corpo deve ser `bytes` UTF-8 com até 4096 bytes e único objeto JSON; chaves duplicadas em qualquer nível, constantes JSON não padronizadas, atributos não permitidos, mismatch operação/rota, método ou caminho suspeito são recusados.
- A identidade é determinada **somente** por `authorize_intent` da PR #290, não por campos `role`, `service_account`, `email`, `workflow`, ou headers arbitrários.
- Antes de aceitar uma proposta sintética, o ID de caso deve coincidir com o hash derivado do caminho. O contrato `simulate_qa_intent` da PR #288 ainda realiza restrições de formato e papel. O mediador online futuramente deverá conferir fonte, owner, revisão, orçamento, idempotência e política no banco, dentro de uma transação real.
- Para ativação, `approved_by_operator` e `trusted_policy_snapshot` são argumentos **exclusivos do laboratório de testes**, nunca derivados do corpo ou dos cabeçalhos; a função não autentica aprovadores nem lê Firestore. Qualquer adaptador real deverá obter essa autorização de mecanismo externo independente e impor CAS.
- Resposta positiva **nunca inclui planos Firestore, tokens, claims, nomes de documentos, payload ou credenciais** e não escreve em lugar algum.
- Não existe Flask, FastAPI, socket, cliente de banco, endpoint de rede, token real, credencial WIF ou permissões novas. Não adicionar execução deste módulo a qualquer job privilegiado ou à produção.

Os testes em `scripts/test_guardian_v2_qa_http_envelope.py` executam só dados sintéticos e substituem temporariamente o verificador Google **dentro dos testes**, sem introduzir interface de injeção no código de produção. São executados no check de segurança existente.

## Limitações e próximas ações necessárias

1. **NO_GO** para serviço real até confirmação independente do projeto/banco QA, duas identidades autenticadas distintas, WIF, custos autorizados, auditoria IAM e rollback. `qa_project` verificado por formato não é prova de ambiente isolado.
2. Definir o **adaptador web real** somente após revisão de ameaça e implantação de Cloud Run privada com invocadores restritos. Deve confirmar fluxo real do token preservado em `Authorization`; cabeçalhos de proxy e múltiplos headers exigem parsing do framework escolhido e testes próprios.
3. Implementar persistência protegida e transações Firestore **server-side**; verificar autorização externa e impedir acesso de credenciais de jobs diretamente ao banco. Nunca confundir `SIMULATED_*` com permissão IAM real.
4. Executar os 16 cenários de evidência externa em QA, autenticação contra Google real, adulteração do script de triagem, concorrência entre instâncias e reversão controlada.
5. Não alterar cron, WIF, environment, Firebase, IAM, Cloudflare, backups, `main`, dados reais ou produção sem autorização específica.

## Validação no Termux

```bash
python3 -m unittest scripts.test_guardian_v2_qa_http_envelope -v
```

Este passo **não requer APK novo**, pois não altera código Android. O CI da PR é a fonte para confirmar o resultado em cada HEAD.

Referência técnica para etapa futura: https://docs.cloud.google.com/run/docs/authenticating/service-to-service e https://googleapis.dev/python/google-auth/latest/reference/google.oauth2.id_token.html.
