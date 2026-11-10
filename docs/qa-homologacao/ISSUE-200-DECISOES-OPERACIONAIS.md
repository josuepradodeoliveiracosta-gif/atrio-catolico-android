# Issue #200 — decisões operacionais pendentes do Átrio Conversas

**STATUS: MINUTA / NÃO APROVADO. Sem implantação, sem abertura de chat,
sem prazo de exclusão definido.** Escopo: somente conversas privadas
e grupos; não fixa idade mínima para outras partes da comunidade.

## Já decidido, sem confundir com comprovação de idade

A idade mínima para usar o chat é **18 anos completos** (decisão de
10/11/2026, substituindo 16 anos). A pré-triagem opcional durante o
cadastro é local e não é prova. O mecanismo confiável de maioridade
no servidor **não foi selecionado, aprovado ou implantado**.

## Registro operacional ainda exigido para a issue #200

| Área | Deliberação a registrar | Evidência operacional antes do GO |
| --- | --- | --- |
| trustedAgeProof | Método de aferição 18+ confiável, revogação, proteção da identidade e falha fechada | Avaliação de privacidade e testes reais de fraude, expiração e indisponibilidade |
| contactConsentAndAbusePrevention | Solicitações, bloqueio bilateral, antispam, assédio, aliciamento e medidas proporcionais | Matriz negativa de bloqueios, reclamações e tentativas repetidas |
| reportIntakeAndTriage | Canal, prioridade, prazo de triagem, responsável pelo plantão e comunicação ao denunciante | Roteiro testado com contas QA, sem acesso irrestrito a mensagens |
| moderatorAssignmentsAndAccess | Quem credencia/revoga moderadores e como auditar acessos mínimos | Evidência de IAM e revogação imediata; PR #221 é prova apenas de emulador |
| appealsAndEmergencyEscalation | Recurso humano, urgências e encaminhamento responsável; não presumir um SLA | Simulações de incidentes sem dados reais, com auditoria |
| formerMemberEvidence | Como ex-participantes denunciam sem reabrir histórico privado | Testes de acesso a protocolos antigos e bloqueio de outros históricos |
| subjectRightsAndDeletion | Acesso, correção, eliminação, contestação e verificação da identidade do solicitante | Procedimento de solicitação e revisão documentada |
| retentionPolicyAndHolds | Prazos por classe, base jurídica, impedimentos legais, recursos e backups | Inventário aprovado e ensaio de preservação antes de qualquer eliminação |
| privacyLegalReview | Responsável, parecer, data, risco residual e revisão periódica | Registro profissional rastreável sem dados pessoais em logs públicos |
| qaRolloutAuthorization | Escopo e período de um teste QA explícito, rollback, contas fictícias, IAM e custos | Parecer técnico específico e evidência do Firebase QA real |
| productionRolloutAuthorization | Deliberação autônoma após QA real e verificação no aparelho | Aprovação independente, sem inferir de CI ou merge |

## Classes de dados a tratar separadamente

| Classe | Prazo | Base jurídica | Legal hold / denúncia / recurso | Destino |
| --- | --- | --- | --- | --- |
| `directMessages` | **pendente** | pendente | pendente | pendente |
| `groupMessages` | **pendente** | pendente | pendente | pendente |
| `directReports` | **pendente** | pendente | pendente | pendente |
| `groupReports` | **pendente** | pendente | pendente | pendente |
| `groupInvites` | **pendente** | pendente | pendente | pendente |
| `hiddenMessages` | **pendente** | pendente | pendente | pendente |
| `directMetadata` | **pendente** | pendente | pendente | pendente |
| `groupMetadata` | **pendente** | pendente | pendente | pendente |
| `chatAgeEligibility` | **pendente** | pendente | pendente | pendente |
| `groupEligibility` | **pendente** | pendente | pendente | pendente |
| `chatPreferences` | **pendente** | pendente | pendente | pendente |
| `auditTrails` | **pendente** | pendente | pendente | pendente |
| `backups` | **pendente** | pendente | pendente | pendente |

Não copiar os prazos de uma classe para outra. A exclusão de um
documento pai do Firestore não elimina automaticamente suas
subcoleções. Nenhum prazo de retenção pode ser inferido de um teste.

## Forma de registrar as decisões

O arquivo `ISSUE-200-REGISTRO-PENDENTE.json` preserva
**11 deliberações pendentes** e **13 classes sem prazo aprovado**.
É somente um modelo estruturado, sem nome de decisor, prazo, prova
ou autorização inventados. O verificador
`scripts/qa_issue200_decision_gate.mjs` rejeita:

- retorno à idade mínima de 16 anos;
- `qaDeploymentAuthorized` / `productionDeploymentAuthorized` verdadeiros;
- tema de moderação ausente ou marcado aprovado sem fluxo de revisão;
- prazo presumido de retenção, dispensa legal não justificada ou classe faltando;
- campos desconhecidos e quaisquer tentativas de simular aprovação.

Qualquer deliberação humana futura exige **uma revisão separada e
explícita do documento, do contrato e de suas evidências**, sob escopo
QA/produção claramente distinto. Nem um `approvedBy` informado
manualmente comprova identidade ou autorização. Este gate **não pode
ser transformado em ferramenta de liberação automática**.

## Correspondência com os laboratórios existentes

- PR #218: consumo único de desafio/JTI sintéticos para idade, não provedor real.
- PR #219: consultas de convites em duas composições Firestore Emulator.
- PR #220: preflight NO-GO das Rules, incluindo issue #200 aberta.
- PR #221: protocolos e revogação de moderadores em regras do emulador.
- PR #222: inventário sintético sem exclusões e com proteção a holds.

Essas evidências são úteis para a análise técnica, mas **não aprovam
políticas, aferição etária, tratamento jurídico nem QA real**.
Até decisão humana e autorização específica, os controles do chat
continuam fechados. Sem novos serviços, custos, mudanças em `main`,
produção, Worker, Firebase, APK ou backups.

**Progresso geral: 2/7 marcos (29%). Marco 3 em preparação / NO-GO.**
