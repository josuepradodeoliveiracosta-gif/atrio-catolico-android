# Átrio Conversas — registro de decisões de segurança para homologação

**Estado: MINUTA PENDENTE. Não é aprovação, política publicada, parecer
jurídico, autorização de deploy nem comprovação de idade.**

Escopo: Átrio Conversas, mensagens diretas e grupos, na PR draft #193.
Consolida os portões abertos da issue #200 e do roteiro de retenção existente,
sem decidir pelo fundador ou pela revisão de privacidade/jurídica.

## Condições atuais verificadas

- A suíte Firestore Emulator testa bloqueio por `minorPolicyApproved`,
  `safetyReviewVersion`, `version` e `enabled` (valores de teste apenas).
- Elegibilidade para grupos exige decisão administrativa e
  `reviewExpiresAt` posterior à hora da requisição, mas **não comprova idade**.
- O Firebase QA real foi verificado por leitura somente leitura no Termux do
  operador: projeto/app Android ativos, Firestore QA **deny-all**.
- Worker Cloudflare `atrio-qa-geral` está em bootstrap fechado, sem FCM.
- Nenhum teste automatizado substitui revisão humana, jurídica ou de privacidade.

## Quadro de decisões ainda obrigatórias

| Tema | Decisão a registrar pelo responsável | Evidência mínima antes da ativação | Estado |
| --- | --- | --- | --- |
| Público e menores | Faixas permitidas, estratégia de aferição de idade, supervisão quando aplicável e revogação | Avaliação de risco e conformidade, fornecedor/método avaliado, testes de falsificação, expiração e indisponibilidade | **PENDENTE** |
| Solicitações e bloqueios | Consentimento e prevenção de contato não solicitado, assédio, spam e aliciamento; limites e sanções | Testes de bloqueio bilateral, abuso, troca de conta, limites e recursos | **PENDENTE** |
| Denúncias | Canal de entrada, equipe credenciada, acesso mínimo, prioridade, triagem, recurso e emergência | Roteiro de incidentes e testes de privacidade; nenhuma leitura geral de DMs por moderador | **PENDENTE** |
| Evidências e ex-integrantes | Preservação, proteção e apresentação de denúncias por ex-membros sem ampliar acesso privado | Testes de desligamento, remoção, não repúdio, abuso de protocolos e controle humano | **PENDENTE** |
| Retenção por coleção | Prazos e bases por classe: mensagens, grupos, convites, denúncias, preferências, auditoria, backups | Inventário aprovado, preservação legal, minimização, testes de expurgo sem perda indevida | **PENDENTE** |
| Direitos do titular | Procedimentos de acesso, correção, eliminação, contestação e identidade do solicitante | Procedimento operacional, trilha sanitizada, separação de papéis, custos | **PENDENTE** |
| Aprovação final | Revisão jurídica/privacidade, responsável, data, escopo e autorização de rollout **separada** | Ata/registro de decisão e testes end-to-end reais específicos do escopo autorizado | **PENDENTE** |

## Fases e efeitos proibidos

1. **Preparação e testes offline:** podem continuar na PR #193 e em
   emuladores fictícios; não marcam nenhuma decisão como aprovada.
2. **Revisão humana de política:** registrar decisões, motivação, responsável,
   data e risco residual; revisar antes de qualquer abertura do Firebase QA.
3. **Autorização específica de QA:** não é inferida de um teste verde ou
   desta minuta; exige revisão do conjunto de regras e dos dados de teste,
   separação do Firebase, prevenção de menores e plano de rollback.
4. **Autorização independente para produção:** requer homologação física,
   revisão de segurança/privacidade, plano de migração/OTA e aval explícito.
   Nenhum merge em `main` ou Release automático.

**Não realizar agora:** alterar `minorPolicyApproved` na nuvem, implantar
regras candidatas, habilitar FCM, inserir credenciais no repositório, conectar
`atrio-qa-geral` a produção, ativar retenção automática ou apagar históricos.

Referências internas: issue #200, issue #199, issue #201,
`docs/atrio-conversas-retencao-homologacao.md` e
`docs/atrio-conversas-termux-firebase-qa.md`.

### Registro futuro de deliberação

- Responsável pela decisão: **não preenchido**.
- Data e versão do parecer: **não preenchidas**.
- Avaliação jurídica/privacidade: **não apresentada**.
- Escopo autorizado (QA ou produção): **nenhum**.
- Decisão de ativação: **NÃO AUTORIZADA**.

Até essas decisões serem aprovadas, a barra de progresso do ambiente QA
permanece **2 de 7 marcos (29%)**; a etapa 3 segue em preparação.
