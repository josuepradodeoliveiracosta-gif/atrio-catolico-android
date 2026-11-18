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
