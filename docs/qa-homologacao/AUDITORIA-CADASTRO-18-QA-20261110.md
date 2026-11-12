# Auditoria técnica do cadastro 18+ — PR #232 (QA, 10/11/2026)

**Classificação: AUDITORIA ESTÁTICA/EMULADOR, NÃO É AUDITORIA DE FIREBASE QA REMOTO.**
Escopo: [PR #232](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/232), candidato `feat/qa-chat-self-declaration-candidate-20261110`, em cima da branch de QA da PR #193. Não foi efetuada implantação no Firebase, alteração em produção, mescla ou acionamento de serviços reais.

## Constatações verificáveis e riscos residuais

| Controle | Evidência no código e testes | Situação |
| --- | --- | --- |
| Nascimento e idade no app | `ChatAgeRegistrationPrecheck.kt` valida datas por calendário estrito e 18 anos; `RegistrationV2.kt` apresenta data/checkbox somente no Chat QA | Implementado no candidato; **idade apenas informada** |
| Minimização | O campo de nascimento usa estado Compose não persistido; `OnlineAtrioApp.kt` envia somente quatro campos do sinal autodeclarado | Inspeção do fluxo específico; outras fontes devem ser auditadas antes do deploy |
| UID e campos | `self-declaration-candidate.mjs` limita criação a `me(uid)`, mapa exato, status/versão e validade de até 366 dias; update/delete/list negados | Testes de usuário cruzado, extras e revogação administrativa |
| Elegibilidade do próprio usuário | `qaChatAge18Eligible` verifica versão, status e vencimento; `chatEnabled()` exige `minorPolicyApproved`, `enabled`, versão e `safetyReviewVersion` | Candidato só: bloquear ao expirar, faltar prova, política desativada ou versão trocada |
| Sessão | `emailVerificationAllowsCommunityAccess()` usa `request.auth.token.email_verified`; login e sessão não permitem leitura de outro UID | Emulador, sem autenticação do Firebase QA remoto |
| Participação e bloqueio | Conversas exigem participantes/bloqueios nos atos de envio; grupos requerem associação e elegibilidade administrativa `chatGroupAccess/eligibility` | **Declaração 18+ não libera grupos automaticamente**; verificar requisito com fundador |
| Privilégios | `admins/{uid}` é necessário para ler protocolos de terceiros e não há acesso irrestrito a DMs/grupos por papel de moderação | Ensaios prévios #221 (emulador); exigir revisão conjunta das Rules antes de deploy |
| Isolamento | Workflow de teste usa `demo-atrio-v11`, credenciais de rede vazias, package Chat QA segregado e JSON Firebase fictício | CI cobre artefato sintético, NÃO prova estado remoto atual |
| Worker / FCM | Worker QA de notificações tem contratos próprios de `eligible`/versão e gates de política | **Incompatibilidade pendente** com `declared_18_plus`; manter FCM desligado |
| Dados pessoais e política | Autodeclaração não comprova idade; não há prazo de retenção/moderação #200 aprovado nem avaliação jurídica conclusiva | Impede ativação com usuários externos e fechamento #200 |

## Riscos a mitigar antes do QA real

1. **Autodeclaração falsificável:** cliente pode mentir ou escrever os quatro campos permitidos diretamente na API para o próprio UID. É **característica solicitada** do protótipo fechado, não verificação confiável nem barreira contra menores em testes abertos. Não equiparar `minorPolicyApproved=true` à comprovação.
2. **Fluxo administrativo de grupos:** autorização do chat individual após declaração não implica elegibilidade automática de grupos, por gate independente. Regra mais restritiva deve ser mantida até decisão consciente e revisão.
3. **Confirmação assíncrona:** Firestore `.set` da declaração não bloqueia a criação da conta, e o código registra falha em log sem mostrar resolução ao usuário. Se a escrita falhar, o chat continua indisponível. Antes do teste real, prever estado de pendência/recuperação sem reabrir conta por cache.
4. **Expiração e revogação:** não há renovação automática; após vencimento ou revogação por admin o chat fecha. A forma segura de renovação deve ser desenhada sem permitir restauração de revogação pelo próprio cliente.
5. **Verificação remota incompleta:** estado real Firebase QA `atrio-catolico-qa-geral` foi documentado anteriormente como deny-all, mas **não foi consultado novamente nesta auditoria**. Para a etapa de ativação, exigir GET autenticado estritamente read-only do projeto, RuleSet/release, IAM, quotas e rollback; rejeitar qualquer apontamento para produção.
6. **Governança:** canal de denúncias/moderação, retenção por classe, direitos de usuários e eventual acesso por menores precisam de decisões da #200 e revisão de privacidade. Não há autorização para ativar Rules/Worker ou liberar testes abertos.

## Critério desta etapa

Considerar **auditoria de código e emulador concluída** apenas se o workflow específico da PR #232 executar no mesmo SHA com cenários negativos de configuração desligada, registros inválidos/expirados e acesso não autorizado a grupos, além de compilar Chat QA e verificar seus hosts/assinatura. Isso **não** basta para a auditoria integral do Firebase QA real, que precisa de leitura remota atual e documentação de IAM. A barra desta tarefa não deve ser promovida a 40% com base somente em CI verde.

**Sem deploy, sem mudanças em `main`, sem novas credenciais, sem alteração de backups.**

## Última verificação autenticada — comando único

O projeto remoto QA **não pode ser lido a partir desta conversa sem uma
conexão Firebase autenticada**. Foi preparado um verificador que usa o login
Firebase CLI já presente no Termux e o arquivo local privado
`app/src/chatQa/google-services.json`, sem imprimi-lo, para executar
**exatamente 4 requisições GET** restritas ao projeto `atrio-catolico-qa-geral`.

No clone local da branch QA com o Firebase CLI já autenticado, execute:

```sh
node scripts/termux-firebase-qa-audit-readonly.mjs
```

A ferramenta valida a identidade do projeto e aplicativo Android em
`firebase.googleapis.com`, depois lê release e RuleSet ativo em
`firebaserules.googleapis.com`. Ela exibe apenas projeto, app, horário local,
SHA-256 do conteúdo das regras e `remote_rules_deny_all`. O token é
obtido somente em memória, sem ser copiado para arquivos, respostas ou logs.
Nenhum deploy ou escrita de dados é realizado.

O resultado `QA_REAL_DENY_ALL_CONFIRMED` confirma que o snapshot remoto
está fechado, **não** que seja seguro ativar o chat. O resultado
`QA_REAL_RULES_NOT_DENY_ALL` (código de saída 2) exige investigar a
divergência, sem qualquer alteração automática. Erros falham fechados com
identificadores genéricos. Nunca compartilhar tokens, `google-services.json`
ou credenciais; o resumo sanitizado é apropriado para registrar evidências.

**Atualização após evidência do operador (11/11/2026):** a consulta
**real e autenticada** agora foi executada no Termux pelo fundador, que
forneceu a captura do resultado sanitizado nesta conversa. A identidade,
as regras publicadas e a negação total foram confirmadas nesse instante.
Permanece pendente aprovar o escopo da política #200 e as dependências de
ativação. A captura do operador não comprova IAM completo, FCM, nem
comportamento em dispositivos reais.

## Resultado remoto autenticado — evidência do operador

- **Origem da prova:** captura do terminal Termux do fundador, após copiar
  uma configuração privada QA validada para a pasta
  `~/atrio-workspaces/qa-cadastro`. Captura analisada nesta conversa,
  não enviada ao repositório.
- **Ferramenta:** `scripts/termux-firebase-qa-audit-readonly.mjs`,
  commit `236210f940dbc87d52d1e51d7d3371c87e8526b2` antes
  desta atualização; método `FOUR_QA_GET`.
- **Horário retornado no terminal:** `2026-11-11T01:16:22.664Z`.
- **Projeto:** `atrio-catolico-qa-geral`.
- **Pacote Android:** `br.com.atriocatolico.chatqa`.
- **Resultado:** `status=QA_REAL_DENY_ALL_CONFIRMED`,
  `remote_project_and_app_verified=true`,
  `remote_firestore_rules_verified=true`,
  `remote_rules_deny_all=true`.
- **Hash SHA-256 das Rules remotas:** `cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b`.
- **Sinalizadores do relatório:** `ready_for_activation=false`,
  `production_contacted=false`, `changes_performed=false`.
- **Limitação:** evidência do operador e verificador read-only, sem uma segunda
  leitura independente nesta sessão ChatGPT e sem auditoria de IAM. O
  estado é um snapshot; futuros deploys podem alterá-lo.

**Conclusão da etapa 2 da tarefa específica:** auditoria do código,
permissões Firestore candidatas, testes de negação, isolamento do app/projeto
e leitura de Rules publicadas no Firebase QA **concluídos para o escopo de
pré-ativação read-only**. A barra da tarefa de ativação pode avançar de
**20% a 40% (2/5 etapas)**. Isso **não** altera o marco geral QA:
**2/7 = 29%, NO_GO**. Antes do deploy, confirmar IAM/identidade de quem
pode publicar Rules, plano de rollback, moderação/retenção e consentimento
de política da issue #200; Worker/FCM e autorização de grupos continuam
pendentes. O Firebase QA real permanece deny-all; nenhum deploy realizado.
