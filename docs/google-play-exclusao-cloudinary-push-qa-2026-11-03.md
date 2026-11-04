# Átrio Católico — homologação de Cloudinary e Push (QA, 03/11/2026)

**Conclusão:** foram implementados e validados testes de leitura posterior a uma remoção **simulada**. Nenhuma conta, ativo Cloudinary, token FCM ou documento Firestore de usuários reais foi modificado. `releaseAuthorized:false`; não liberar o AAB nem atualizar os Workers de produção.

## Verificações externas somente-leitura

Consulta do Cloudinary conectado, prefixo `atrio-avatares/qa-delete-`: nenhuma imagem encontrada nos tipos `upload`, `authenticated` ou `private`. Não há evidência de que o cloud/nome de conta conectado seja exclusivo de QA. Não executar `upload_asset`, `delete_asset` nem invalidação nesse ambiente sem comprovação de separação física, proprietários e política de backup. Resultados vazios sob um único prefixo não são prova global de exclusão, derivados ou backups.

Inspeção da branch Play:
- A origem das inscrições de dispositivos é **Firestore**, sob `users/{uid}/pushDevices/{deviceId}`, e não as três tabelas do D1 de Push (`delivered`, `push_delivery_stats`, `guardiao_ai_budget`).
- O método `devices()` no Worker de Push filtra tokens expirados, vazios ou malformados **para envio**. Esse método **não pode** ser reutilizado como inventário de exclusão: os documentos ignorados podem ainda existir.
- O Android tenta cancelar inscrições em tópicos, chamar `deleteToken()` e apagar o registro do dispositivo. Isso não remove todos os dispositivos de outras sessões, não prova revogação universal do token no provedor FCM e pode não concluir depois de `account_deletion_freeze`, pois as regras do Firestore exigem `accountWritable(uid)` para excluir `pushDevices`.
- Envio via tópico legado não permite excluir destinatários individualmente. O candidato da PR bloqueia broadcasts gerais, mas isso **ainda não foi implantado em produção**. Revisar tokens históricos e tópicos antes de aprovar a exclusão.

## Contrato implementado na PR #71

`cloudflare/account-deletion-audit/src/qa-external-readback.js` é **somente leitura**: não contém fetch, SDK, segredos nem chamadas de delete. As únicas identidades aceitas são as duas contas fictícias `qa-freeze-alice` e `qa-freeze-bob`. O escopo de mídias QA é `atrio-privacy-qa-20261103/<uid>/<uuid>` e os documentos QA de dispositivos só usam nomes `qa-device-*` e impressões digitais falsas `qa-fingerprint-*`.

Duas operações puras:
1. `captureQaExternalBaseline`: exige conta de teste congelada com zero operações em trânsito, inventário **não vazio** da mídia e do dispositivo antes da mutação, e inventário de outra conta de teste para controle.
2. `verifyQaExternalReadback`: recebe o baseline previamente capturado e executa **duas leituras completas** após uma mutação de *fixture* executada fora do verificador. Recusa mídias ou documentos residuais, alteração em outra conta, paginação incompleta, repetida ou circular, registros sem escopo correto, formatos inesperados ou falhas de leitura. O resultado positivo afirma somente `qa_scoped_readback_only`.

O contrato **nunca** atesta backups, derivados, CDN, revogação de token no FCM, tópicos legados, validade do IAM externo ou bloqueio dos Workers em produção. Todas essas flags e `playReleaseAuthorized` são obrigatoriamente `false`.

Os 14 testes Node em `qa-external-readback.test.js` cobrem inventário anterior, duas leituras pós-remoção, preservação da segunda conta, erros/remoções parciais, renascimento de arquivos ou dispositivos, identificadores de outra conta, formatos e tipos desconhecidos, freeze insuficiente, paginação e ausência de quaisquer métodos de escrita.

## Bloqueios restantes

1. Confirmar **Cloudinary verdadeiramente segregado**, ID da conta de teste, credenciais restritas, política de derived/backups e processamento de exclusão/invalidação; depois criar e remover somente ativo descartável, com duas verificações reais independentes.
2. Testar com Firebase Emulator e, posteriormente, **projeto Firebase QA separado**, um inventário total e paginado de `pushDevices` (incluindo documentos que o emissor não usaria), remoção pelo Admin SDK com controle de versão, regras de reingresso/freeze e prova que o Push Worker não tentará entregar mensagens ao UID.
3. Auditar tópicos FCM legados, registros do D1 com `event_key` potencialmente identificável, referências cruzadas e retenção de moderação; uma falha na identificação de dados deve impedir finalização de Auth.
4. Exigir duas pessoas responsáveis pela autorização e revisão legal LGPD e Play antes de habilitar qualquer remoção em produção.

**Observação metodológica:** um baseline não assinado e uma leitura de mocks não constituem evidência de exclusão remota. O módulo foi mantido desligado dos Workers implantados e não deve ser importado por rotas públicas.
