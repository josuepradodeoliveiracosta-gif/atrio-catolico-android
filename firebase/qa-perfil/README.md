# Perfil 2.0 — Rules de QA, candidato estritamente offline

**Agente 4 / Segurança • 14/11/2026.** Depende de PR #291 (histórico),
PR #294 (contratos Firestore), PR #295 (ambiente) e coordenação com PR #193
(Gradle `chatQa`). Este diretório NÃO é usado por `firebase.json` da raiz,
portanto não substitui `firestore.rules` da produção.

## Destino exclusivamente proposto

- Projeto: `atrio-catolico-qa-perfil`, banco `(default)`;
  aplicativo registrado: `br.com.atriocatolico.perfilqa`.
- O fundador comprovou via Termux o índice `posts(uid ASC, createdAt DESC)`
  com escopo `COLLECTION` e estado **READY** na Issue #105.
- A regra `deny-all` foi vista no editor Firebase; **a release realmente
  publicada ainda precisa ser confirmada** via leitura de metadados.
- Não executar `firebase deploy` nem apontar a produção, QA Geral ou
  Conversas para este arquivo. **Este candidato NÃO está aprovado para deploy.**

## Escopo intencional da primeira etapa

`firestore.rules` permite somente:

1. Cadastro e leitura do próprio documento `profiles/{uid}`, com nome
   e data controlados; edição após e-mail verificado, com consistência
   transacional obrigatória com a apresentação pública, se houver.
2. Leitura pontual de `public_profiles` por membros com e-mail
   verificado; criação/edição vinculada ao perfil privado no mesmo
   estado `getAfter`, sem enumeração.
3. Leitura de `posts` comunitários por membro verificado. Consultas
   obrigatoriamente limitadas a **20** registros, como o Perfil 2.0 da
   PR #291. **Não restringe posts por UID nas Rules**: a consulta do
   cliente usa o filtro para selecionar o histórico, não para tornar
   publicações privadas.
4. Leitura pontual de selos/fotos já existentes, sem conceder papéis
   ou upload; leitura pontual de metadado `email_verification`.
5. `deny-all` para todas as outras rotas. Não habilita chats,
   Guardião, relatórios, preferências de fé/paróquia, notificações,
   dados de crianças, consentimento, criação/edição/exclusão de posts,
   gestão de selos ou exclusão de conta.

**Limitação funcional conhecida:** a política de laboratório permite
**histórico e edição de perfil**, não a homologação integral do app.
Os posts de teste deverão ser **sintéticos** e somente poderão ser
provisionados depois de autorização separada, por operador confiável.
Nunca contornar Rules com credenciais administrativas em código Android.

A exigência de `email_verified` é **fail-closed** e não depende de
configuração `app_config` ausente, ao contrário da política de
compatibilidade legada de produção. Sem um APK `perfilQa` vinculado
a este projeto, sem dados sintéticos e sem Rules publicadas, o
aplicativo remoto não deverá funcionar: isso é esperado.

## Testes offline

`tests/security/qa-perfil-rules.test.mjs` usa exclusivamente o Firebase
Emulator com `demo-atrio-v11`. É executado como parte de `npm test`
na branch derivada da PR #294. Cobre titular/terceiros/anônimo,
verificação de e-mail, edição com `getAfter`, paginação 20+5,
varredura legada, consulta excessiva, posts comunitários, bloqueio
de autoatribuição de selos, dados religiosos e demais rotas.

O teste e a análise estática não demonstram que a política foi publicada.

## Gate operacional — Termux, somente leitura

No clone do repositório, executando exatamente esta branch:

```sh
node scripts/termux-perfil-qa-rules-readonly.mjs
```

O script consulta **dois GETs**, exclusivamente
`projects/atrio-catolico-qa-perfil` no Firebase Rules API; exige
sessão já autenticada na Firebase CLI e mostra apenas o hash do
Ruleset, estado `deny-all` e igualdade de hash com o candidato
local. Nunca mostra tokens nem conteúdo integral das Rules.

**Estado aceitável nesta etapa:** `publishedDenyAll=true`,
`matchesCandidate=false` (candidato ainda não publicado). Resposta
403, dados inesperados ou política não fechada exige investigação,
não publicação. O script é apenas prova de metadados, não teste de
autorização com clientes nem de IAM de serviço.

## Próximos portões

1. Executar CI no SHA exato e solicitar revisão do Agente 7.
2. Fundador/operador executa auditoria da release **via Termux**,
   compartilha somente resultado sanitizado.
3. Agentes 2/3/7 alinham variante `perfilQa` com `chatQa` da #193
   e provas de `project_id`, `applicationId` e ausência de
   fallback para o JSON/hosts de produção, sem compilar APK oficial.
4. **Qualquer publicação futura** requer autorização explícita e
   específica do fundador após revisão e planejamento de reversão.
   Não autorizar ampliação para testes de outros módulos por esta PR.
5. Agente 5 executa teste físico com contas/dados estritamente
   sintéticos depois da aprovação de infraestrutura. Integração
   #291/#294 continua NO-GO até esses gates e decisão do fundador.

Não usar nem inserir dados reais, credenciais, tokens, fotos pessoais
ou chaves de serviço. Não habilitar billing, PITR ou serviços pagos.
