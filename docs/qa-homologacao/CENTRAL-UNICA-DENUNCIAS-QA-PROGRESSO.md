# Central Única de Denúncias — acompanhamento QA

**Projeto iniciado 12/11/2026. Não ativado para usuários.**
Progresso exclusivo deste projeto, **não confundir** com ativação QA
(60%, 3/5) ou homologação geral (29%, 2/7).

**Engenharia: 1/6 concluído; segundo marco implementado, aguardando CI.**
`[███░░░░░░░░░░░░░░░░░] 17%`

| Marco | Estado | Evidência ou condição |
| --- | --- | --- |
| 1. Auditar canais existentes | CONCLUÍDO | `user_reports`, `chat_reports`, `chat_group_reports` e painel administrativo identificados |
| 2. Roteamento e entrada de prévia QA | IMPLEMENTADO, CI PENDENTE | Policy Kotlin, JUnit, entrada antes do login **somente no Chat QA**; nenhum formulário/envio |
| 3. Canal excepcional de recebimento | BLOQUEADO | Definição de autenticação alternativa, proteção contra abuso, privacidade e aprovação |
| 4. Fila única administrativa | PENDENTE | Integração no painel atual, acesso mínimo e revisão humana |
| 5. Evidências, recursos, retenção e urgências | PENDENTE | Procedimento e fundamento aprovados, testes de abuso |
| 6. Homologação/ativação específica | PENDENTE | Teste real, rollback, segurança e autorização independente |

## Contrato técnico inicial
O novo `UnifiedReportEntryQaPolicy` apenas indica a rota de UI
preexistente quando o usuário está autenticado e mantém acesso ao
contexto. Os demais casos retornam `EXCEPTIONAL_PENDING_APPROVAL`;
não leem histórico privado, não concedem privilégios, não emitem
recibo, não criam coleções e não enviam dados.
A prévia `UnifiedExceptionalReportQaPreview` existe apenas na variante
`br.com.atriocatolico.chatqa`, antes do login, sem formulário. O
projeto oficial não passa a exibir o botão.

## Bloqueios mantidos
Nenhuma decisão presumida sobre canal de atendimento, equipe, plantão,
ferramenta de recebimento, verificação de solicitante, anexos,
retenção, recurso, LGPD/ECA Digital ou autorização de publicação.
A issue #200 permanece aberta e a PR #232 draft. Não alterar produção,
`main`, Firebase QA real, Workers, dados ou backups.
