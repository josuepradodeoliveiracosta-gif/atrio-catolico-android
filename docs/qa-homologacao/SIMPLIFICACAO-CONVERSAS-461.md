# Simplificação controlada — homologação funcional de Conversas (#461)

Escopo autorizado: exclusivamente atrio-catolico-qa-general, Alice e Bob fictícios. Manter autenticação e e-mails verificados, elegibilidade 18+ vigente em ambas as pontas, configuração da rodada, consentimento do destinatário, bloqueio bilateral, transações, quota, autoria e integridade de mensagens. Documentos de Push e restauração continuam privados; não liberar listagem global de chats. A fronteira gerenciada existente, se presente, continua fechando as escritas legadas.

O candidato offline `simple-direct-rules.mjs` combina a captura publicada já fixada por hash com o fragmento direto versionado e fixado por blob. Não inclui grupos nem índice gerenciado. Preserva o acesso às evidências de moderação publicado; o novo relato usa o contrato de autoria existente e não concede novas leituras. A moderação por caso e a migração definitiva são etapas posteriores. Não usar em produção.

## Marcos de progresso (cada um vale 1/8)

- [x] Delimitar escopo, invariantes e congelar base publicada.
- [x] Compor candidato funcional restrito e escrever testes.
- [x] Validar pedido, aceite, envio, revogação e negativas no emulador (b37de7e, run 45680297178; alterações posteriores exigem revalidação).
- [ ] Preparar APK/Worker e verificar o caminho de emissão real; D1, Auth/IAM e publicação da pendência.
- [ ] Aprovar e aplicar composição QA com rollback e conferência da release.
- [ ] Restaurar 18+ por autorização de uso único; readmitir ambas as contas sem expiração da admissão e desativar operador temporário.
- [ ] Registrar dispositivos e confirmar conversa no Android real.
- [ ] Confirmar FCM aceito, chegada, aviso, toque e negativos de sessão, permissão e bloqueio.

A composição não altera firebase.json, não faz deploy e não substitui a autorização de publicação. A janela de revisão 18+ permanece finita; admissão permanente não elimina esse controle. Sem prova de entrega real até a última etapa. A barra é por marcos, não por tempo ou linhas de código.

Candidato Android: modo direto exige `qaSimpleDirectEnabled: true` na configuração publicada, identidade QA física exata e ausência da descoberta gerenciada. Consulta somente o documento canônico, com Source.SERVER; preferências por documento, sem listagem geral. A flag vem ausente/fechada por padrão. Não ativar antes de revalidar as Rules e o APK. A publicação da pendência e emissão FCM continuam etapas distintas.

### Primeiro disparo real (assistido)

A primeira rodada mantém a publicação administrativa da pendência, com o serviço `createAuthenticatedConversationPushAdmin` existente. Depois de uma mensagem nova confirmada pelo Android e posterior a ambas as admissões, o operador publica a pendência para o ID canônico; o remetente aciona **Testar Push QA da última mensagem** no APK. O botão só aparece no par físico QA autorizado, com a última mensagem própria confirmada, em conversa aceita. O POST usa o ID token do remetente e envia somente tipo e IDs; nunca texto ou credenciais administrativas. O Worker ainda revalida as condições e reserva D1. `accepted_by_fcm` não comprova recepção. Não se trata de Push automático; automatizar a publicação exige etapa posterior com autorização e revalidação de IAM. Não ampliar escrita IAM do Worker para acelerar o piloto.


### Pré-voo administrativo local

Em checkout isolado com `npm ci` de `tests/security`, `node qa-simple-direct-admin.mjs prepare /root/atrio-qa-candidate` gera regras candidatas, rollback, manifesto e SQL D1 localmente (diretório novo); `node qa-simple-direct-admin.mjs preflight` consulta apenas QA, não publica. A identidade D1 deve ser validada antes de aplicar SQL; nenhum outro banco. O operador desativado precisa coincidir com o e-mail verificado da credencial ADC. O modo `restore`/`publish <messageId>` só é elegível após ruleset candidato publicado, flag explícita e ausência de fronteira gerenciada/bloqueios. Requer autorização operacional da rodada. A restauração usa revisão de 24 horas (janela autorizada), readmissão sem expiração e compensação das alterações identificadas se falhar. O modo publish usa aviso de até 2 min. O operador recebe senha aleatória em memória e capacidades mínimas, autenticação Firebase real, sem exposição de endpoint, e é desativado, tem claims limpas e sessões revogadas em finally. Se houver interrupção abrupta ou falha de limpeza, não continuar: `node qa-simple-direct-admin.mjs cleanup` com a mesma ADC verificada, depois novo preflight. Não executar escrita antes de validar o executor no emulador e autorizar a implantação. Não logar chaves, tokens ou textos. A leitura direta dos dados exige identidade exata. A publicação do Worker, D1 e Rules é separada.

Diagnóstico de 25/11: a ADC obteve HTTP 200 e e-mail verificado em `userinfo` sem quota de projeto, mas HTTP 403 com `x-goog-user-project`. O executor omite esse cabeçalho somente na URL exata de identidade; as APIs administrativas continuam vinculadas ao projeto QA. O e-mail retornado continua sendo confrontado com o operador no Auth. Nenhuma mudança de IAM ou ruleset decorre desse ajuste.


### Rodada 44 e reaproveitamento de infraestrutura

A auditoria do Worker publicado (versão `234cf784-78ad-442b-81e8-a35c37324e7e`) confirmou o caminho existente `/event` e `/notice`, validações de Auth, gerações, pendência, D1 e sinal FCM sem conteúdo. A identidade do D1 já foi configurada no banco existente e a permissão `firebaseauth.users.get` concedida exclusivamente à conta de serviço QA. Não é necessário substituir o Worker para o primeiro disparo assistido. A proposta de APK 44 mantém o pacote registrado e a versão 43 intacta. Exige perfil físico funcional HTTPS, origem fixa e descoberta gerenciada desligada. O ensaio CI usa configuração fictícia e certificado descartável; não produz APK instalável como atualização da assinatura definitiva. Antes da assinatura real, confirmar a versão instalada, a disponibilidade do código 44 e a revisão do Item 13; preparar rota de assinatura protegida fixada por SHA/árvore em PR separada, sem entregar segredos à branch candidata. A compilação protegida real exige aprovação do fundador e execução em main protegida. Não há autorização implícita de merge ou deploy.


### Evidência do APK 44 e regressão independente do Item 13

Execução 45696169772, commit `dde45bef002a1ffcb9cda7eeb77642f3e284809b`: quatro jobs aprovados; o job APK 44 gerou e verificou APK fictício de pacote `br.com.atriocatolico.qageral.celular`, código 44, nome `0.19.10-qa-geral-celular-rodada-44`, manifesto HTTPS e certificado descartável. Não é artefato de atualização real.

A verificação histórica de Item 13 permanece inalterada e vermelha: 11 dos 12 blobs são idênticos à referência histórica, enquanto `AtrioConversations.kt` mudou. A inspeção de linhas contendo referências a denúncias, moderação e evidências não identificou mudanças nesses trechos, mas não substitui teste funcional. O workflow adicional `qa-conversas-item13-regression.yml` conserva os onze pins históricos, exige o blob exato de Conversas `0bb7b7a0ff2fc36cbeb48001f94987e20e02ff23` do candidato testado e executa a mesma suíte Android de atendimento por caso, sem segredos nem rede real. Não desabilita o guard histórico, não altera seus critérios, nem declara aprovação do Item 13 antes da execução. A conciliação definitiva da referência histórica exige revisão explícita.


### Diagnóstico de relógio do executor (25/11)

A primeira restauração real abortou com `admission_verification_failed`; o pré-voo seguinte confirmou operador fechado e ambas elegibilidades revogadas. Alice teve a admissão revogada pela compensação, Bob manteve a admissão histórica inválida. O Firestore apresentou horário de leitura adiantado em relação ao dispositivo (estimativas de 1337 e 609 ms incluindo latência). A causa específica ainda não foi comprovada. A validação administrativa usa `readTime` do Firestore, mantém ordem estrita por nanossegundos, exige metadados e recusa horários futuros, provas revogadas/expiradas e gerações divergentes. Em falha, somente nomes de predicados são informados. Teste simula relógio local atrasado e negativas. Não altera ruleset, Worker ou APK 44 já instalado.


### HTTP 503 do Worker QA — diagnóstico

Em 25/11 a pendência Bob → Alice foi publicada, mas o Android recebeu 503. `/health` responde 200 e `/notice` sem sessão 401. O cliente Python padrão recebeu 403/1010 do Cloudflare; curl autenticado reproduziu `503 notice_unavailable` e `503 unavailable` com mensagem inexistente. D1 não tem reserva de entrega ou contador de disparo. A conta de serviço tem chave cadastrada; isso não comprova o segredo publicado. O candidato de instrumentação registra apenas etapa predefinida e código HTTP numérico em console.warn, sem credenciais, IDs, corpos, URLs ou paths. Não muda resposta externa, políticas, destinatário, limites nem deduplicação. Publicação e habilitação de logs do Worker existente requerem aprovação separada, após testes e comparação de módulos com a versão publicada.


### Compatibilidade workerd — HTTP 503 (25/11/2026)

O piloto instrumentado (Worker QA versão 7, SHA-256 `403296613848149c6c5ad937d04ebf9522212f892024008305a98161a6f9e348`) registrou `auth_http:0` e `event_auth:0` na tentativa das 20h46 (Fortaleza). A documentação oficial https://developers.cloudflare.com/workers/runtime-apis/request/ confirma que o modo `redirect: 'error'` não é implementado em Workers; a construção da requisição falha antes do envio. O candidato troca exclusivamente o wrapper do piloto para `manual`, rejeitando todos os 3xx, status zero e resposta opaca de redirecionamento antes de devolver qualquer resposta ao chamador. Testes verificam modo manual e rejeição 301/302/303/307/308 sem outra chamada, reserva D1 ou envio FCM. Respostas públicas, regras, limites, identidade, credenciais e APK inalterados. A confirmação de ponta a ponta depende da publicação QA aprovada e novo ensaio real. Não modificar main nem outros Workers.


### Rodada 45 — diagnóstico local de recepção (26/11/2026)

Bob envia com notificações desligadas; Alice recebe com opt-in, em instalação independente no mesmo celular. Três envios assistidos aceitos pelo FCM; notificação comum do Console Firebase entregue, mas sinal de dados de Conversas não comprovado. O registro de Alice chegou a divergir do token atual; desativar/reativar e comparar hashes confirmou uma correspondência. O terceiro envio ainda não apareceu. A rodada 45 conserva pacote, origem QA, regras, autenticação, proteção de TTL, horários, consulta canônica e deduplicação; acrescenta diagnóstico local limitado ao último callback por conta fictícia na instalação, códigos HTTP sanitizados e classificação de rejeições. Sem ADB, telemetria externa, tokens, IDs de mensagens, conteúdo ou logs brutos. O painel indica solicitação de notificação, não recebimento visual. Nenhum APK assinado/publicado nesta etapa; a assinatura permanente e as verificações de upgrade permanecem obrigatórias. O registro automático de token requer revisão separada após evidências.
