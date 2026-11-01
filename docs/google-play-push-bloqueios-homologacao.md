# Átrio Católico — homologação do bloqueio em notificações

**Estado: preparado para QA; não implantado na produção, não autoriza Play.**
Branch: PR #71. Data: 31/10/2026.

## Problema real, confirmado no código

O Worker `cloudflare/push-worker/src/index.js` distribuía respostas pelo tópico FCM `atrio_thread_{postId}`. Inscritos antigos nesse tópico poderiam receber push mesmo após bloquear ou ser bloqueados por alguém. Regras de segurança do Firestore não restringem envios executados pelo service account do Worker. Filtrar o feed no Android também não impede o recebimento do push.

## Caminho de testes, sem tocar em usuários reais

O fluxo de respostas agora usa obrigatoriamente `blockSafeThreadRecipients()` para verificar, via identidade de serviço, tanto `users/{autor}/blockedMembers/{destinatario}` quanto `users/{destinatario}/blockedMembers/{autor}`. Um resultado de leitura diferente de 404/200 válido aborta o evento (fail-closed). Para respostas, o Worker não publica `message.topic`, mas envia FCM por token aos destinatários aprovados e escreve avisos internos somente para eles. Se exceder **5 destinatários**, limita o envio conservadoramente e sinaliza `block_safe_capacity_suppressed`, sem publicação em tópico. O código removeu o envio de respostas para tópicos FCM mesmo quando a variável legada está ausente ou definida como `false`. **A versão de produção implantada não foi modificada nem homologada.**

**Testar primeiro em um Worker de homologação isolado**, após confirmar conta, projeto Firebase de testes, D1 separada, credenciais temporárias de QA e ausência de rotas reais. Não editar o Worker que atende usuários atuais. Esta mudança não habilita produção nem exige flag para funcionar depois de implantada. A proteção só poderá ser considerada operacional após *deploy* controlado, validação de tráfego e plano de rollback seguro.

## Critérios mínimos de aceitação

1. A publica, B comenta, C segue: nenhum bloqueio -> alertas direcionados corretos para participantes. Tópico FCM não recebe nova publicação em modo seguro.
2. A bloqueia B, depois B tenta responder / curtir / acompanhar / salvar / reagir: regras negam as novas gravações. A também não recebe alerta originado de B se o cliente antigo tentar enviar evento.
3. B bloqueia A: idem em sentido recíproco. Desbloquear dos dois lados restaura apenas as interações futuras lícitas.
4. O bloqueio ocorre **após B já se inscrever no tópico**: nem novo push de tópico nem alerta individual indevido.
5. Testar usuário que é autor do post, participante antigo, resposta direta, menção, cliente offline, troca de UID e falhas do backend.
6. Falha 401/403/429/500/503 na consulta de bloqueio: **zero mensagens FCM e zero gravações internas novas** para o evento. Conferir logs sem IDs, tokens ou conteúdo pessoal.
7. Falha na resposta de D1 ou FCM não provoca loop de envio; deduplicação, auditoria anônima e limitação do Free precisam seguir funcionais.
8. Mais de cinco destinatários: **falha de capacidade segura**, sem tópico nem aviso parcial para bloqueados. Definir estratégia de escalonamento com custo e requisitos antes de ampliar o grupo.
9. Emulador Firestore com duas contas, testes Node do Worker e teste Android real obrigatórios; validar o pacote Play somente após existir faixa fechada.

## Gatilhos e controles

- A suíte `cloudflare/push-worker/src/index.test.js` contém testes de filtragem bilateral, falhas de consulta, limites de capacidade e exercício completo com FCM/Firestore simulados; a integração padrão verifica ausência de tópico sem a flag e mesmo se a flag legada estiver em `false`.
- A suíte `tests/security/user-safety.test.mjs` testa regras Firestore de respostas, curtidas, salvos, seguir, reações e denúncias.
- CI: `cloudflare-push-ci.yml`, `selos-ci.yml` e `play-closed-aab-ci.yml`. Passar no CI não comprova implantação, autenticação dos dados reais ou instalação pela Google Play.
- **Não marcar** `block_users` ou `closed_track_ugc_e2e` como verificados sem prova revisada, URL HTTPS de evidência válida, versão da política, testadores e validação de ponta a ponta.
- **Não assinar nem publicar AAB por causa dessa mudança isolada.** Privacidade/exclusão real, termos publicados, moderação e Play Console são bloqueios separados.

## Impedimentos e rollback

A habilitação em produção depende de plano de compatibilidade com APKs já instalados, testes de carga/limites de subrequests, e aprovação de mudança do serviço. **Reimplantar uma revisão antiga do Worker NÃO é um rollback seguro enquanto usuários tiverem bloqueios**, porque reativaria broadcast tópico sem controle por destinatário. Em um incidente, preferir suspender *envios de respostas* de forma controlada até restaurar o filtro, preservando o restante dos dados e a triagem da comunidade. O rollout deve ter circuito de corte seguro e plano de acompanhamento humano.

Apenas equipes com acesso autorizado podem publicar o Worker; nenhuma chave de serviço deve ser adicionada ao GitHub, ao APK ou a este documento.
