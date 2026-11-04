# Átrio Católico — autorização por caminho de escrita em QA

**Data:** 03/11/2026. **Estado:** implementação candidata na PR #71; proibida a implantação em produção.

## Objetivo e escopo

A proteção distribuída existente já administra ingressos no D1, tickets de operações em trânsito, congelamento `active → draining → frozen`, HMAC por função e fechamento por reconciliador independente. Esta revisão acrescenta o caminho interno `POST /v1/write/admit` **somente** ao coordenador privado de QA e ao cliente de Service Binding. Uma solicitação `{route,scope}` deve corresponder exatamente a um dos **15** caminhos conhecidos pela auditoria, ao papel que chama o Worker e aos UIDs sintéticos `qa-freeze-alice`/`qa-freeze-bob`.

O registro `cloudflare/privacy-freeze-stage/src/write-route-grants.js` não fornece qualquer permissão de Firebase, FCM ou Cloudinary. Ele apenas identifica o tipo de ticket do banco D1 fictício:
- **Avatar (5):** upload, promoção/status, remoção, moderação e revisão de moderação.
- **Guardião (3):** revisão, resolução de revisão e scanner agendado.
- **Push (7):** aviso de discussão, evento FCM, transmissão QA limitada, evento de moderação, revisão de moderação, fila de bots e limpeza de registro de dispositivo.

Somente um destinatário sintético por operação Push múltipla é aceito em QA. Os parâmetros devem ter chaves exatas; um destinatário repetido ou a mesma conta em papéis incompatíveis é rejeitado. Nenhuma identidade real é válida. Credenciais por função, nonce único e HMAC continuam obrigatórios.

O coordenador valida papel/caminho **depois** de autenticar e **antes** de registrar o nonce. A admissão então reutiliza o `INSERT ... SELECT` transacional do barrier: se qualquer participante estiver `draining` ou `frozen`, nenhum dos seus registros é admitido. Um ticket já admitido permanece pendente mesmo após o início do congelamento; o reconciliador separado precisa encerrá-lo antes de o freeze finalizar.

## Evidências esperadas de CI

`qa-stage-service-binding.test.js` executa todos os 15 caminhos contra **Worker.fetch real do módulo QA + Service Binding HMAC + SQLite persistente**, sem Internet, provedores externos ou credenciais reais. Verifica permissão por função, rejeição de permissões cruzadas, UID real, objeto com chaves extras, vários destinatários, HMAC assinado com papel indevido, replay de nonce, bloqueio de todas as rotas no congelamento, preservação do segundo UID e corrida entre admissão e congelamento.

Os 15 caminhos **continuam explicitamente `not_integrated` com produção** em `qa-worker-coverage-contract.js`, mesmo após aprovação dos testes. O código não deve ser inserido diretamente em um Worker produtivo por simples troca de binding. Antes de fazer isso é necessário revisar IAM, credenciais exclusivas, efeitos de rede, reconciliação independente com prova da ação, drenagem de operações em trânsito, rollback, direitos de terceiros, limites da plataforma e política de retenção.

## Restrições

- Sem alteração de `main`, D1 produtivo, Cloudinary, Firestore/Auth remoto, FCM, backups ou Play Console.
- Sem alegação de proteção de todos os escritores reais: os testes são do **protocolo de admissão em QA**, não das 15 integrações reais.
- Sem disparar exclusão da conta real, revogar token ou liberar assinatura AAB.
- Após a aprovação, `releaseAuthorized:false` e PR em rascunho permanecem obrigatórios.
