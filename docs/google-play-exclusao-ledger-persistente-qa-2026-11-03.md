# Átrio Católico — executor de exclusão com ledger persistente (QA)

**03/11/2026 · PR #71 · implementação segregada / sem produção.**

## Situação real

O executor `cloudflare/account-deletion-processor/src/controlled-executor.js` já possui sete etapas obrigatórias: congelar escritores, remover Firestore, remover mídia e referências D1, revogar FCM, verificar ausência de dados, **apagar Firebase Auth por último** e verificar novamente. Ele usa adapters injetados e não possui credenciais ou rotas produtivas. Um teste integrado já executa Firebase Admin SDK **de verdade contra Auth e Firestore Emulator**, D1/Cloudinary/FCM apenas em simulação; não há autorização para contas reais.

**Lacuna corrigida nesta revisão:** a suíte integrada utilizava um array em memória para guardar as fases. Uma falha de processo poderia perder os checkpoints. Agora usa `qa-persistent-case-ledger.js`, um **arquivo SQLite privado dentro de diretório temporário descartável**, que conserva a solicitação e as fases mesmo após encerrar a conexão.

## Garantias do ledger de QA

- Apenas projeto `demo-atrio-v11`, UIDs descartáveis `qa-delete-alice`/`qa-delete-candidate`, arquivos `ledger.sqlite` em diretório privado temporário nomeado `atrio-qa-delete-ledger-*`. Rejeita bancos em memória (não duráveis), diretórios inseguros, outros objetos SQLite, bases anexadas, tabela com colunas desconhecidas, projeto real e UID estranho.
- **Imutabilidade da solicitação**: um UID não pode receber um segundo `caseId` enquanto existir caso de exclusão. A versão do lease (`epoch`) impede reutilizar uma autorização antiga depois da aprovação de retomada.
- **Fases em ordem fixa**: `complete` registra transações `BEGIN IMMEDIATE` com condição de versão/checkpoint, permitindo avanço somente à próxima fase. Fase repetida, pulada ou fora de ordem não é registrada.
- **Falha fechada na interrupção**: um novo `acquire` encontra o caso `active` e recusa reexecução automática. `approveRecovery` exige função de revisão independente e estado idêntico após sua conclusão; respostas ambíguas não reativam a conta. Após aprovação, o lease recebe novo `epoch`; o antigo torna-se inválido. Um caso integralmente concluído permanece consultável sem reiniciar efeitos destrutivos.
- O arquivo não pode ser implantado em Workers, não acessa rede nem constitui autorização da empresa, LGPD ou prova de revogação Cloudinary/FCM. A aprovação de recuperação no teste é uma **assertiva de fixture**, não assinatura criptográfica de um revisor real.

## Homologação exigida nesta etapa

`qa-persistent-case-ledger.test.mjs` testa persistência após reabertura, recuperação explicitamente aprovada, concorrência de aquisições, tentativas de outro caso, privilégios de produção, permissão de arquivo, schema desconhecido, checkpoints corrompidos e proibição de nova exclusão automática.

`tests/security/admin-fixture/qa-controlled-executor-e2e.test.mjs` passa a usar **esse ledger persistente no lugar do array de autorização** e a reiniciar a conexão SQLite depois da exclusão da fixture. Verifica que os sete checkpoints sobrevivem e que uma segunda execução do executor **verifica**, mas não apaga novamente, a identidade do Auth Emulator.

Estas provas **não** homologam Cloudinary real, FCM remoto, política de retenção, IAM produtivo, bloqueio distribuído de todos os 15 caminhos de escrita, projetos segregados hospedados ou envio Google Play. O gate permanece `releaseAuthorized:false`, PR draft e nenhuma conta real pode ser eliminada.

## Próximos requisitos para conclusão produtiva

1. Resolver classificação e retenção das denúncias, dados de terceiros, registros Guardião, coleções órfãs e identificadores de mídia.
2. Comprovar **Firebase QA remoto e Cloudinary QA separados**, com credenciais limitadas, antes de qualquer efeito remoto; inventário de antes/depois, retries e falhas injetadas.
3. Reusar o protocolo de ticket/freeze em todos os Workers produtores de escrita, com verificação de parada e conciliação antes do Auth.
4. Implantar backend privado com autorização de operador, revisão independente assinada, ledger persistente de produção e mecanismo seguro de recuperação.
5. Demonstrar processamento real de exclusões de contas fictícias no ambiente segregado; apenas depois discutir habilitação gradual em produção e liberação do teste fechado Play.

**Proibição:** não alterar backups, chaves, contas reais, documentos Firebase produtivos, tabelas D1 produtivas, imagens Cloudinary reais, release ou assinatura.
