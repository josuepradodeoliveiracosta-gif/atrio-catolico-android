# Central Única de Denúncias — acompanhamento QA

**Projeto iniciado 12/11/2026. Não ativado para usuários.**
Progresso exclusivo deste projeto, **não confundir** com ativação QA
(60%, 3/5) ou homologação geral (29%, 2/7).

**Engenharia: 2/6 marcos concluídos e validados no CI (33%).**
`[███████░░░░░░░░░░░░░] 33%`

| Marco | Estado | Evidência ou condição |
| --- | --- | --- |
| 1. Auditar canais existentes | CONCLUÍDO | `user_reports`, `chat_reports`, `chat_group_reports` e painel administrativo identificados |
| 2. Roteamento e entrada de prévia QA | CONCLUÍDO NO CI | Policy Kotlin e JUnit aprovados no `3b3ce35`; entrada antes do login **somente no Chat QA**; nenhum formulário/envio |
| 3. Canal excepcional de recebimento | PREPARAÇÃO OFFLINE (1/4 SUBETAPAS) — BLOQUEADO | Contrato e testes de ameaças criados; faltam transporte, autenticação alternativa, privacidade e autorização; sem endpoint |
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


## Validação automática do marco 2 (12/11/2026)

- Código: `3b3ce359f63d65e8c22facad8ed16a174a2d0164`.
- Segurança/Emulator: https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43230114826 — completed/success, **132/132 testes**, zero falhas.
- Android QA sintético/JUnit: https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/43230114864 — completed/success, **2/2 jobs**.
- O APK não foi instalado em celular e nenhum serviço remoto foi alterado.
- A ativação continua **NO_GO**; são necessários 4 marcos restantes.

## Marco 3 — preparação segura em subetapas (12/11/2026)

**Marco 3 permanece aberto.** O progresso geral mantém **33% (2/6)**,
pois não há recebimento excepcional efetivo.
As quatro subetapas preparatórias, em ordem:
1. [x] Definir contrato de entrada e matriz de ameaças **somente offline**,
   `scripts/chat-qa-exceptional-intake-contract.mjs` e testes;
   validação CI do commit desta mudança ainda deve ser confirmada.
2. [ ] Selecionar/justificar infraestrutura de ingresso sem permitir
   escrita anônima diretamente no Firestore; desenhar antispam,
   limites por origem/dispositivo, App Check e alternativa adequada
   para quem não tem conta, com proteção de privacidade.
3. [ ] Especificar protocolo idempotente **confirmado em servidor após
   gravação durável**, separação de campos e fila de moderação,
   testando falhas parciais, revogação, abuso e não enumeração.
4. [ ] Revisar com responsáveis por moderação e privacidade,
   documentar base/finalidade/retencão, aprovar e testar operação
   **somente em ambiente QA** com autorização específica.

O contrato simula 480 combinações sem coletar relatos, credenciais,
e-mails, documentos, anexos, identificadores ou contatos.
Um ACK fictício, até de gravação simulada, **não emite protocolo**;
nenhum caso gera recibo, sanção, consulta privada ou escalonamento
real. A lista de oito controles de aceite permanece **toda pendente**.
Não considerar revisões `REVIEW_RECORDED` como aprovações.
Toda a implementação fica em `NO_GO`; QA real e produção intocados.
