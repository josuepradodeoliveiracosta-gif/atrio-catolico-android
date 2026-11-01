# Átrio Católico — Push/FCM: ensaio de escrita privilegiada (somente QA)

Preparado em 31/10/2026 sobre a PR #91. Nenhuma rota ativa, Workers, IAM,
D1 remoto, Firebase, Cloudinary, Play Console, assinatura ou backup é alterado.

## O que este ensaio comprova

- O adaptador `src/qa-push-outbound-gate.js` classifica **antes do transporte**
  três operações isoladas: um aviso Firestore por lote de um destinatário,
  envio direto FCM para token de fixture e exclusão condicional de dispositivo.
- Valida `actorUid` e `recipientUid` nas escritas de aviso; para FCM direto
  valida somente o destinatário; para exclusão, o proprietário da inscrição.
- Exige um ingresso atômico no ledger SQLite de QA antes da chamada e só o
  finaliza após resposta HTTP bem-sucedida e validação de efeito injetada.
- Resposta ambígua, batch com erro ou verificação inconclusiva deixa operação
  pendente; a conta não pode ser declarada congelada nesse estado.
- Os testes usam `writeThreadNotices` e `cleanupInvalidDevice` **reais**
  do Push Worker, com rede simulada, IDs falsos e duas contas fictícias.
- O teste de bypass mostra deliberadamente que uma chamada do Worker original
  sem este adaptador ainda ignora a barreira.

## O que continua **SEM cobertura**

- Fan-out Firestore para múltiplos destinatários: o ensaio rejeita lotes
  com mais de um aviso em vez de oferecer falsa garantia de atomicidade.
- FCM por tópico, disparos por broadcast, relatórios de moderação, fila,
  reenvios, retries, cron, registros de idempotência e auditoria no D1.
- Verificação de identidade real (IAM/Firebase), tokens reais, Cloudflare
  D1 remoto, integração dos entrypoints e Workers já implantados.
- Atomicidade distribuída entre D1, Firebase/FCM e Cloudinary.
- Exclusão efetiva de Authentication, Firestore, imagens e inscrições push.
- Portal HTTPS público, atendimento verificável e finalização da issue #72.

## Como validar

No workflow de privacidade já existente, os arquivos `src/*.test.js`
são executados pelo Node 22 com `--experimental-sqlite`. Nenhum segredo,
recurso de produção nem serviço externo é necessário. Até a CI homologar
esta branch, a implementação deve ser tratada como **não verificada**.

## Ordem recomendada para avançar

1. Homologar CI e revisar os testes de payload e concorrência.
2. Mapear origem/identidade e **todos** os caminhos do Worker: eventos,
   tópicos, broadcast, moderação, fila, D1, FCM e retries.
3. Projetar um controle real sem bypass com identidade confiável, testes em
   Firebase Emulator e Cloudflare D1 de QA isolado, plano de reconciliação.
4. Completar o processamento de exclusão ponta a ponta e portal HTTPS;
   testar dois usuários e todos os backends.
5. Só então revisar o requisito de exclusão para Google Play, o AAB
   assinado e o teste fechado.

**Readiness do teste:** `productionIntegrated=false`.
Não usar como autorização para excluir contas, publicar na Play,
integrar na main nem alterar apps dos testadores. Preservar OTA e backup.
