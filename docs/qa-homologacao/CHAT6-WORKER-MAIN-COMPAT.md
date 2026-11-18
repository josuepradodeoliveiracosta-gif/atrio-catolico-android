# Chat 6 — composição mínima Worker QA Conversas sobre main

**Referência inicial:** main `74358dcb1c3eb8cdc7e3de23bfd1501485bc626b`; PRs históricas #231/#351 e contrato de maioridade #232.

Esta branch acrescenta exclusivamente ferramentas de **QA offline** ao código atual da main.
O módulo `chat-qa-main-adapter.mjs` parte de `src/index.js` da **main atual**,
adiciona os contratos estritos de chat e grupos selecionados das PRs anteriores
e gera um Worker QA *isolado* com guardas de projeto/identidade/D1.
A função recusa mudanças de forma inesperadas na fonte, não substitui o
Worker oficial nem o relay de navegação QA já presente na main.

- `PUSH_ENABLED=false`, `workers_dev=false` e `preview_urls=false` no TOML gerado.
- Configurações, chaves, UUID, UID e mensagens reais não participam dos testes.
- Contratos 18+: `eligible/2026-11-18plus-qa-v1` ou
  `declared_18_plus/2026-11-selfdecl-qa-v1`, em pares exatos com expiração e
  quatro campos obrigatórios; o segundo significa **autodeclaração**, não
  verificação independente. **Chat 2** deve confirmar a semântica e
  elegibilidade no Firestore Emulator/Rules antes de integração.
- Testes offline cobrem deduplicação, 429/503, respostas FCM ambíguas,
  múltiplos dispositivos, bloqueios, revogações, exclusões e silenciamento.
  Um recibo FCM não prova entrega; a política D1 at-most-once pode perder avisos.
- O Worker QA gerado NÃO está publicado nem conectado ao APK. Para uma futura
  integração, revisar também a diferença entre o projeto histórico
  `atrio-catolico-qa-geral` e o relay de navegação QA da main
  `atrio-catolico-qa-general`. **Não misturar credenciais ou dados**.
- **Custos:** teste sem rede, sem D1 remoto e sem mensagens pagas. Na lógica de
  #231, dispositivos adicionais geram até 8–9 leituras extras em DM e 11 por
  dispositivo de grupo. Projetar volume/cotas/latência antes de ativar.
- **NO-GO remoto:** exige Chat 4 (segurança), Chat 5 (CI/três bots),
  Chat 7 (composição/arquitetura) e aprovação específica do fundador.

## Paridade de contrato etário (ensaio da main)

A `main` atual, via `firebase/qa-general/age18-gate.mjs`, admite apenas
`eligible/2026-11-18plus-qa-v1` nas Rules sintéticas de acesso a chat.
A alternativa da #232 admite apenas `declared_18_plus/2026-11-selfdecl-qa-v1`.
O Worker QA gerado revalida ambos os pares, **mas somente despacha** quando
`ATRIO_QA_AGE_POLICY` corresponde ao `status` de autor e destinatário,
na última reconsulta anterior a D1 e a cada dispositivo posterior.
A configuração gerada traz `ATRIO_QA_AGE_POLICY="disabled"`, além de
`PUSH_ENABLED=false`; falta escolher Rules reais compatíveis e validar
no mesmo Firebase Emulator antes de qualquer autorização de ativação.
Uma string de ambiente não comprova qual Ruleset remoto está implantado.
O modo legado permanece transitório, conforme parecer do Chat 2 na PR #351.

## Inventário de chamadas offline, custos e margens do plano Free — 18/11/2026

O [job Node #44410176124](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/44410176124)
contou cada chamada `fetch()` de mocks Firebase Auth, OAuth, Firestore REST e
FCM e cada chamada `PUSH_DB.prepare()` no cenário de um único destinatário,
com 1–3 tokens. O mock registra o custo **sintético**; não representa métricas
Cloudflare de produção, cache, redirecionamentos ou custo monetário.

| Fluxo | Aparelhos | Chamadas HTTP simuladas | Operações D1 simuladas | Soma ilustrativa |
| --- | ---: | ---: | ---: | ---: |
| DM | 1 | 19 | 4 | 23 |
| DM | 2 | 28 | 4 | 32 |
| DM | 3 | 37 | 4 | 41 |
| Grupo | 1 | 25 | 4 | 29 |
| Grupo | 2 | 37 | 4 | 41 |
| Grupo | 3 | 49 | 4 | 53 |

**Alerta de capacidade, NO-GO por ora:** Workers Free admite **50
subrequests externas por invocação** e possui também limite separado de
subrequests internas; D1 Free limita consultas por invocação. Uma única
entrega a três aparelhos no grupo já exige **49 `fetch()` simulados**,
restando margem mínima. Redirecionamentos, novas chamadas ou outros
destinatários no mesmo evento podem exceder o limite. A soma 53 é apenas
contador de operações misturadas, **não uma prova isolada de estouro da
cota de 50 chamadas externas**. Antes de ativar, escolher/implementar
otimização segura (sem dispensar revogação), limite por invocação, divisão
autorizada de trabalho ou outra solução dentro dos recursos gratuitos,
seguida de prova de fan-out de grupos com 2–8 participantes e 1–3
aparelhos com falhas concorrentes. Nunca ignorar silenciosamente pessoas
e alegar entrega completa.

A cota gratuita também inclui **100.000 invocações Workers por dia**,
**10 ms CPU por requisição**; D1 Free disponibiliza **5 milhões de linhas
lidas/dia**, **100.000 linhas escritas/dia** e **5 GB** de armazenamento
total. Esses números não são promessa de disponibilidade/custo futuro e
devem ser revistos no dia de qualquer eventual ativação. Rotinas que
registram métricas em D1 podem acrescentar escritas. O recibo FCM
`projects/.../messages/...` só prova aceite pelo provedor e não sua
chegada ao telefone; não há repetição automática após falha ambígua.

Referências oficiais:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/

**Parecer Chat 6:** GO para laboratório e revisão da composição em `main`;
NO-GO para considerar consumo/cobertura de grupos homologados, para FCM
real, deploy ou integração protegida. Pendente Chat 2 paridade de Rules
com o Worker no MESMO Firebase Emulator, Chat 4 auditoria de segurança e
cotas, Chat 5 testes de três bots, Chat 7 revisão do patch isolado.

## Bloqueio preventivo da capacidade, sem plano pago (Chat 6)

Os nove cenarios offline de grupos com **2, 3 e 7 destinatarios** e
**1, 2 e 3 aparelhos** agora testam recusa em HTTP 503 `qa_capacity_limit`
**antes** da reserva D1 ou de qualquer chamada FCM. A recusa ocorre logo
depois de conferir os membros canonicamente no Firestore e impede a
varredura descontrolada de permissões de cada participante. O envio
normal a um unico destinatario permanece em ensaio. Este limite e
provisorio: nao equivale a suportar todos os tamanhos de grupo.
Proibir redirecionamentos automáticos de OAuth/Auth/Firestore/FCM
evita subrequests adicionais e destinos inesperados.

Para implementar um fan-out completo futuro, escolher estrategia de
orquestracao/limites gratuitos que continue revalidando bloqueios,
idade, grupo e mensagens sem aceitar sucesso parcial nem gerar retry
duplicado. A cota de 50 subrequests do Workers Free inclui cadeias
de redirect. Novo desenho requer avaliacao conjunta Chats 2/4/5/7.
