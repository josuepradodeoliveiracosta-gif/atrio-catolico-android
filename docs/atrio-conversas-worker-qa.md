# Worker geral de homologação do Átrio Católico (iniciando pelo chat)

**Status:** somente preparação de código na PR #193. Nenhum Worker QA,
credencial, projeto Firebase ou banco D1 foi criado nem publicado aqui.

## Identidade planejada da homologação geral

Firebase `atrio-catolico-qa-geral`, Worker `atrio-qa-geral`, D1 `atrio-qa-geral-db`.
A infraestrutura será compartilhável entre módulos, mas **somente eventos
do chat e de grupos estão atualmente permitidos**. Discussões, perfis,
Guardião, avatares e outros módulos precisam de implementação e aprovação
próprias antes da ativação. O APK `chatQa` continua isolado e específico
para o chat. Estes nomes não provam a existência de recursos na nuvem.

## Por que é necessário

O Worker oficial em cloudflare/push-worker/src/index.js fixa PROJECT como
atrio-catolico e associa Firestore, autenticação e FCM a esse projeto.
Além disso, a política de verificação de e-mail e as rotinas legadas de bots
contêm referências ao projeto oficial. Apenas trocar a URL do APK não isola
o tráfego. **Nunca reutilizar o Worker ou os segredos oficiais para QA.**

## Preparação offline, sem conexão externa

O script cloudflare/push-worker/scripts/chat-qa-build.mjs gera exclusivamente:
- cloudflare/push-worker/src/index.general-qa.generated.js
- cloudflare/push-worker/wrangler.general-qa.generated.toml
- cloudflare/push-worker/schema.general-qa.generated.sql (somente instruções para
  provisionamento futuro do D1 QA; **não executadas** pelo gerador)

Ambos são ignorados pelo Git. O script exige projeto Firebase identificado
como QA, UUID de D1 distinto do banco oficial e reescreve somente âncoras
conferidas do código-fonte original. O Worker produzido:
- deriva Auth, Firestore e FCM do projeto QA especificado na geração;
- restringe API pública a GET /health e POST /event;
- permite apenas eventos chat_message e group_message;
- recusa e-mail não verificado; não importa a política externa oficial;
- não executa a fila de bots da comunidade oficial;
- valida marcador QA, projeto e domínio da conta de serviço em tempo de execução;
- rejeita JWT do Firebase cuja audiência (`aud`) ou emissor (`iss`) não sejam
  do projeto QA, antes de chamar Identity Toolkit. A autenticação verdadeira
  **continua obrigatoriamente** no `accounts:lookup` remoto; a checagem de
  claims locais só bloqueia origens incompatíveis e não valida assinaturas;
- começa com PUSH_ENABLED=false, broadcast e Guardião desligados;
- exige D1 com UUID distinto **e marcador SQL de projeto**. O Worker verifica
  `chat_qa_identity` no D1 vinculado antes mesmo de responder ao `/health`
  ou processar `/event`. Ausência da tabela, marcador divergente e falhas
  de leitura levam a HTTP 503, sem consultar Firebase ou emitir FCM;
- não comprova a criação/isolamento real do banco: o marcador é defesa
  adicional contra vínculo incorreto, não substitui a auditoria do UUID/D1.

Com valores de QA obtidos e aprovados *independentemente*, o operador pode
preparar arquivos locais (sem implantar):

    export ATRIO_GENERAL_QA_PROJECT=SEU_PROJETO_FIREBASE_QA
    export ATRIO_GENERAL_QA_D1_ID=UUID_DO_BANCO_D1_EXCLUSIVO_QA
    node cloudflare/push-worker/scripts/chat-qa-build.mjs

Não salvar credenciais de servidor em Git, variáveis de build público ou APK.
O Worker QA só poderia usar FIREBASE_WEB_API_KEY e
FIREBASE_SERVICE_ACCOUNT_JSON fornecidos como **secrets do próprio Worker QA**
após revisão de identidade, permissões e restrições de rede. A conta de
serviço deve pertencer ao mesmo projeto QA do APK e do Worker. O banco D1
deve ser realmente separado e verificado antes de qualquer ativação de Push.
A tabela e o marcador contidos no arquivo SQL gerado **somente poderão ser
aplicados ao D1 QA após autorização e conferência do ID na Cloudflare**.
Nunca aplicar essas instruções ao banco `atrio-push-delivery` de produção.

## Testes permitidos antes de um ambiente QA real

    node --test cloudflare/push-worker/scripts/chat-qa-build.test.mjs

O workflow .github/workflows/worker-bundle-dry-run-ci.yml gera um cenário
totalmente fictício, executa testes sintéticos e empacota o Worker QA
com Wrangler --dry-run, sem token e sem deployment. Nomes, números e UUID
fictícios **não são serviços provisionados**, e os artefatos não são
distribuídos.

## Portões pendentes para FCM em dois celulares

1. Aprovar Firebase QA, App ID Android, Sender ID e conta de serviço exclusiva.
2. Aprovar Worker/D1 de QA com bindings e permissões segregados.
3. Verificar configuração do APK chatQa real contra esses valores aprovados.
4. Revisar política etária, moderação, retenção e regras de Firestore em QA.
5. Autorizar explicitamente **um deploy somente em ambiente QA**, não produção.
6. Homologar autenticação, recusa/bloqueio, mensagens privadas/grupos e entrega
   FCM em aparelhos físicos, sem expor tokens, UIDs ou textos de conversas.
7. Só então avaliar publicação mediante aprovação independente.

**Nenhum comando de deploy, migração de dados, alteração de Firestore oficial,
merge na main, atualização Release, mudança de Worker publicado ou backup
é autorizado nesta etapa.**
