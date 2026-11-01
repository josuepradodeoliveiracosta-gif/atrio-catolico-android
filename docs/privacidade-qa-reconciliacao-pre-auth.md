# Exclusão de conta — reconciliação final antes de Auth (somente QA)

**Data:** 31/10/2026. **Ambiente permitido:** Firebase Emulator local
`127.0.0.1:8089`, projeto descartável `demo-atrio-v11`; sem credenciais
Firebase de produção. Este código NÃO é serviço de exclusão real.

## Melhoria nesta etapa

O ensaio anterior excluía caminhos fixos de dois perfis fictícios e
confirmava a ausência apenas desses caminhos. Isso não detectava uma
**nova inscrição push** com outro ID, criada entre a verificação inicial e
a etapa de eliminar a identidade Auth simulada. Uma referência em outra
conta, como uma notificação que menciona a conta em exclusão, também
poderia escapar da lista fixa.

Agora `tests/security/qa-deletion-reconciliation.mjs` realiza, no
**momento imediatamente anterior à remoção Auth simulada**, consultas
independentes:

- Raízes conhecidas: perfis, papéis, usuário e avisos do Guardião.
- **Todas** as entradas de subcoleções conhecidas do usuário, mesmo
  documentos criados com IDs imprevistos ou após a coleta anterior.
- Campos de associação ao titular nas consultas relacionais definidas
  por `RELATIONAL_QUERY_SPECS`: posts, replies, referências de
  notificações, denúncias e registros do Guardião.
- Existência da solicitação `requested`, ausência da mídia de fixture,
  congelamento de teste e estado da identidade Auth **fictícia**.
- Uma segunda consulta independente no checkpoint final, inclusive
  quando o diário indica execução concluída.

Se aparecer qualquer dado residual em um escopo conhecido, se uma
consulta falhar ou se o ambiente de teste não for validado, a simulação
**não remove a identidade Auth**. Ao reiniciar, uma etapa já concluída
não dispensa essa verificação final.

## Casos acrescentados

1. Novo `users/{uid}/pushDevices/{id}` criado após a limpeza.
2. Nova notificação pertencente a outro usuário que referencia o UID.
3. Nova referência depois de um diário que declara conclusão.

Todos os testes usam Firestore Emulator e `Set` em memória para
Firebase Auth e Cloudinary; nenhuma conta real ou recurso externo é apagado.

## Limites que AINDA bloqueiam testes fechados Play

- A lista de consultas cobre campos de UID **conhecidos**, não
  coleções futuras, IDs sem UID indexado, menções textuais, órfãos fora
  desses caminhos, backup, retenções ou toda mídia externa.
- O congelamento no runner ainda é simulado em memória, sem garantia
  de ausência de escritas reais concorrentes. Workers originais
  continuam contornando adaptadores QA.
- Auth/Cloudinary são simulados, sem verificação de efeitos remotos.
  Não existe executor confiável autorizado a excluir contas reais.
- Portal público de exclusão ainda não foi implantado e o fluxo
  completo precisa de autenticação, autorização, auditoria, prazos,
  retenção e integração com Firebase/Cloudflare reais.
- `main`, APK/AAB, OTA, assinatura, backup, Play Console e Workers
  operacionais não devem ser alterados por esta proposta.

A política Google Play exige exclusão efetiva dos dados associados e
um caminho no app e na web: **congelamento não substitui exclusão**.

Fonte: https://support.google.com/googleplay/android-developer/answer/13327111

**Readiness:** `productionIntegrated=false`, `globalCoverageComplete=false`.
Manter a issue #72 aberta e a PR em rascunho até CI, revisão e
integração segura em infraestrutura segregada.
