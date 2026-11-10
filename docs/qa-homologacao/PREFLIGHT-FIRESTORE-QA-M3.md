# Revisão dos portões do marco 3 — sem implantação

PR QA isolada: prepara inventário de evidências e bloqueios do Firebase QA.
Não altera `firestore.rules`, nenhum serviço remoto, Workers, app, main ou backups.

Em CI, compõe localmente regras QA restritivas e regras de paridade com
a base versionada e verifica hash da base fixada, portões 18+ e coleção
de convites, ausência de permissões literalmente abertas e deny-all final.
Também consulta **apenas o estado** da issue #200 via GET autenticado
com token de leitura do próprio workflow; erros de API permanecem unknown.

Um operador pode fornecer separadamente JSONs sanitizados gerados pelos
scripts Termux read-only `termux-firestore-qa-readonly.mjs` e
`termux-firestore-rules-diff-readonly.mjs`. O preflight confere formato,
projeto QA, status deny-all e hashes da base, mas não autentica os
JSONs recebidos nem substitui verificação remota independente.

O relatório tem apenas hash SHA-256, estados e códigos de bloqueio;
não publica o corpo das Rules, tokens, usuários ou dados pessoais.
Um teste de CI verde significa **apenas relatório criado**: a ferramenta
permanece NO-GO até revisão humana específica e comprovação técnica.

Bloqueios atuais: issue #200 (política 18+, moderação, denúncia,
retenção e LGPD), evidência de isolamento remoto, aferição etária real,
revisão IAM/custos e plano de rollback, e autorização QA separada.

**QA: 2/7 marcos (29%). Não publicar Rules nem habilitar o chat.**

## Auditoria sem falsos positivos da base legada

O Firestore oficial já possui rotas públicas intencionais. No candidato de paridade, a busca por `allow ... if true` é aplicada ao **delta QA marcado**, enquanto a integridade do texto da base é garantida separadamente pela pinagem do blob e prefixo imutável. Um `allow list: if true` injetado dentro do delta é rejeitado por teste negativo. Isso não substitui a avaliação de sobreposição de permissões no Firebase Emulator.
