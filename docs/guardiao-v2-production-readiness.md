# Átrio Guardião V2 — etapa 4: identidade e registro seguro (PREPARAÇÃO, NÃO ATIVAÇÃO)

## Situação e escopo

A etapa 3 de classificação/alertas/concorrência passou no GitHub Actions [41074253445](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41074253445). A fase 4 **não dá acesso de servidor ao Firebase oficial**: prepara contrato de identidade e checagens. App ainda pré-lançamento; sem usuários reais, sem secrets, IAM ou faturamento novo.

O motor já gera registros de moderação **em uma operação atômica Firestore**, condicionada à versão da mensagem analisada: `guardian_cases/{caseId}`, `guardian_audit/{caseId}` e `guardian_notices/{ownerUid}/items/{caseId}`. Há revisão humana e recurso. Não expor texto original em avisos ou logs. As Security Rules do `firestore.rules` já impedem criação/alteração de casos, auditoria e avisos por APK, e concedem leitura ao administrador ou destinatário conforme a coleção. Esses fluxos foram simulados e verificados no emulador; **não houve escrita pelo Worker remoto de produção**.

## Identidade exclusiva do servidor — exigências ANTES de token OAuth

O módulo `cloudflare/guardian-worker/src/firestore.js` recusa toda tentativa de obter token de produção, sem fazer chamada de rede, a menos que todas as condições sejam verdadeiras:

- `GUARDIAN_FIREBASE_PROJECT_ID=atrio-catolico`, com `GUARDIAN_V2_TEST_MODE` diferente de `true`.
- Aprovações explícitas **independentes**: `GUARDIAN_V2_PRODUCTION_APPROVED=true` **e** `GUARDIAN_V2_IDENTITY_APPROVED=true` (nenhuma delas definida ou ativada agora).
- `GUARDIAN_V2_SERVICE_ACCOUNT_EMAIL` deve indicar uma identidade dedicada no formato `guardian-v2-<nome>@atrio-catolico.iam.gserviceaccount.com`, igual ao `client_email` das credenciais. Não aceitar identidades de QA ou contas genéricas de administrador.
- A estrutura da credencial deve declarar `type=service_account`, `project_id=atrio-catolico`, `token_uri=https://oauth2.googleapis.com/token`, `private_key_id` no formato padrão e chave RSA de serviço. Essas validações **não tornam uma chave segura**, só reduzem configurações acidentais.
- O cache em memória associa o token OAuth ao **projeto + identidade + identificador da chave**; mudança de conta ou rotação de chave não reutiliza o token anterior. Nenhum arquivo de segredo deve ser colocado no GitHub, Android, logs, documentos ou imagens.

**Não** crie nem distribua uma chave JSON agora. O adaptador atual ainda usa chave de conta de serviço para OAuth; para operação contínua, avaliar **Workload Identity Federation/credenciais curtas sem chave**, autenticação suportada pelo ambiente de execução e custo real. A WIF GitHub QA usada em CI é temporária e não concede autenticação ao Worker 24h. A etapa de implantação tem bloqueio técnico enquanto essa decisão não for validada.

## Privilégios mínimos e limites IAM

O Firebase documenta que acesso de servidor REST com OAuth/IAM **ignora as Firestore Security Rules**. O papel `roles/datastore.user` fornece leitura/gravação ampla nos dados do banco, **não é restrição por coleção**. Isso impõe maior risco do que o token Firebase ID do usuário no QA. Antes de atribuir qualquer papel, revisar se uma identidade restrita poderá ter apenas o conjunto necessário de permissões de entidade e o banco de dados exigido, usando papéis customizados ou mecanismos de backend que confiram os caminhos — e validar **na prática**, sem presumir que IAM isola `guardian_cases` de `posts`.

As operações requeridas pelo fluxo atual são leituras de `posts`, `replies`, `reports`, `guardian_config`, `admins`, `guardiao_quarantine` e `guardian_runtime`, além de commits transacionais limitados a `guardian_cases`, `guardian_audit`, `guardian_notices`, `guardiao_quarantine`, `posts/.../replies` (somente retenção/restauração), `guardian_config` e `guardian_runtime`. A revisão humana usa identificação Firebase Auth e regra explícita de administrador ativo. Logs devem conter apenas contadores e códigos, não conteúdo de usuário, credenciais ou token.

## Condições de bloqueio para a etapa 5

1. Escolher o desenho de credenciais **sem chave permanente**, com custos aprovados e escopo verificável; a validação atual ainda não cobre federação 24/7 Cloudflare.
2. Ensaiar a ponte Worker QA com **Firebase ID token verdadeiro** e limites D1 observados. Manter a ponte desligada até a autorização específica.
3. Validar conjunto mínimo de IAM e leitura/gravação em banco e caminhos autorizados, teste negativo de identidade de outro projeto, rotação/revogação e parada de emergência.
4. Confirmar testes Android Debug/recepção de avisos, privilégio humano, recursos e logs/cotas, antes de pensar em produção.
5. Enviar alteração por PR revisada, sem merge automático em `main`. Só uma autorização expressa e verificações completas permitem liberar qualquer moderação real.

Referências: [Firestore IAM](https://firebase.google.com/docs/firestore/security/iam), [papéis e permissões](https://docs.cloud.google.com/iam/docs/roles-permissions/firestore) e [WIF](https://docs.cloud.google.com/iam/docs/workload-identity-federation).
