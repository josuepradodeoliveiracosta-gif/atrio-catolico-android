# Exclusão de contas — Etapa 3: planejamento e simulação de recuperação

Preparação: 31/10/2026. **Sem implantação, exclusão real, publicação ou acesso a dados pessoais.**

## Objetivo e limite

Esta etapa acrescenta ao serviço de **auditoria somente-leitura** da PR #74 um inventário conservador e um simulador com checkpoints. O código NÃO implementa processador com permissões de excluir dados. A simulação só modifica objetos JavaScript fornecidos pelos testes; não contém cliente Firebase Admin, endpoint DELETE, Cloudinary destroy ou credenciais de produção.

As PRs #73 e #74 devem ser revistas antes desta, nessa ordem. A issue #72 continua aberta.

## Inventário de dados fictícios

`src/inventory.js` classifica caminhos por identidade de usuário usando segmentos exatos de UID. Podem ser planejados, para **futura revisão**, os caminhos privados:

- `profiles/{uid}`, `public_profiles/{uid}`, `profile_photos/{uid}`;
- `badges/{uid}`, `badge_requests/{uid}`;
- `users/{uid}` e todas as subcoleções *explicitamente enumeradas*, incluindo notificações, dispositivos push, favoritos, curtidas e discussões seguidas;
- `guardian_notices/{uid}` e itens encontrados nas subcoleções.

Outras coleções precisam de decisão humana: `posts` e respostas de outros participantes; `reports`, `guardian_cases`, `guardian_audit`, `guardiao_quarantine` e `admins`; pedidos de exclusão como prova de atendimento. Não pressupor que remoção da conta autorizaria apagar conteúdo de terceiros ou registros com retenção justificável.

**O inventário é sempre marcado incompleto**: um teste em memória não comprova que encontrou todos os dados relacionados. Em produção, a descoberta deverá usar consultas paginadas por proprietário/UID e enumerate recursively todas as subcoleções, inclusive as de documentos pais já ausentes.

## Simulação idempotente

`src/simulator.js` opera exclusivamente sobre `fixture.simulationOnly=true` com arrays e Sets locais. Ele simula:

1. Revogação de tokens push da conta fictícia;
2. Remoção de referências Cloudinary fictícias, conferidas por proprietário e prefixo;
3. Limpeza de documentos privados explícitos, incluindo subcoleções, sem atingir UID de terceiros;
4. Remoção do UID de um Set fictício de autenticação **por último**.

Cada fase guarda um checkpoint e pode ser retomada. Os testes provocam interrupção depois de uma ação e antes do checkpoint para validar repetição idempotente. Dados compartilhados e registros de retenção continuam intocados. Se aparecer documento privado novo depois do inventário, a etapa fictícia de autenticação é bloqueada. Mesmo ao terminar, o retorno é `simulation_finished_not_production`, nunca `completed` ou prova de exclusão real.

Testes offline:

```bash
node --test cloudflare/account-deletion-audit/src/*.test.js tests/security/account-deletion-web.test.mjs
```

## O que falta antes de qualquer operação real

- [ ] Nomear responsável pelo atendimento LGPD e definir prazos, confirmação de identidade e resposta a solicitações de usuários sem acesso à conta;
- [ ] Concluir classificação de dados pessoais, finalidade, retenções, conteúdo público citado por terceiros, backups e logs;
- [ ] Desenvolver processador administrativo real com acesso mínimo e autenticação adicional (por exemplo Cloudflare Access), **separado** do Worker de leitura;
- [ ] Implementar leitura paginada, bloqueio de alterações da conta durante processamento, checkpoints duráveis/controle de concorrência, exclusão de subcoleções e busca de vínculos cruzados;
- [ ] Integrar revogação de FCM, remoção de mídias Cloudinary após validação de propriedade, limpeza das dependências e Firebase Auth por último;
- [ ] Tornar o atendimento observável, com falhas parciais, retomada e auditoria sem informações sensíveis;
- [ ] Testar ponta a ponta no **Firebase Emulator com contas fictícias** e recursos externos de teste, jamais apagar usuários reais no CI;
- [ ] Hospedar página HTTPS válida, com domínio autorizado pelo Firebase Authentication, política de privacidade e opção externa de solicitação que realmente funcione;
- [ ] Configurar e revisar Play Console somente após comprovar o processo completo.

Referência técnica Firebase: https://firebase.google.com/docs/firestore/manage-data/delete-data?hl=pt-br — excluir o documento pai NÃO apaga suas subcoleções. Para limpar coleções, o servidor deve enumerá-las, trabalhar em lotes e monitorar falhas/custos.

**Sem alterar backup, JKS, OTA, Firebase/Cloudflare de produção ou versões Android.**
