# Átrio Guardião V2 — Etapa 5: critérios objetivos para ativação oficial

**Situação: NÃO APROVADO para produção.** Este arquivo é um roteiro operacional, não uma permissão para deploy, IAM ou faturamento. O projeto ainda está em pré-lançamento e a PR #44 permanece **draft**. Não alterar `main`, APK Release, backups, regras Firebase oficial nem os Workers de Push/Avatar sem autorização expressa.

## Trava A — ligação entre Firebase QA e Cloudflare QA
- [x] Cadastro de conta QA temporária e remoção, Auth + Firestore Rules, token Firebase ID verdadeiro no Termux.
- [x] Execução **local** da implementação da ponte com token real (`QA_BRIDGE_LOCAL_PASS`), D1 e rate limiting simulados.
- [x] Worker QA remoto recusa requisições sem token (401), mantém admin fechado (503); D1 QA restringe tentativas; nenhum usuário real foi moderado.
- [x] Correção do `fetch` do Worker: `redirect: manual`, rejeição explícita de 3xx, sem redirecionar Bearer.
- [x] **Código na branch de testes** exige `GUARDIAN_V2_QA_BRIDGE_NOT_BEFORE` e `GUARDIAN_V2_QA_BRIDGE_EXPIRES_AT`, ambas ISO 8601 UTC, com janela **até 10 minutos**; fora do intervalo recusa antes de D1/Firebase e confere novamente depois da reserva D1.
- [ ] Implantar o código com essas duas variáveis **vazias** no Worker QA e demonstrar `qa_bridge_disabled` com a ponte desligada. A versão remota v17 ainda não contém a nova janela.
- [ ] Com nova autorização/coordenação de teste, habilitar temporariamente **apenas QA** com um intervalo literal curto, em versão separada, `GUARDIAN_V2_QA_FIRESTORE_BRIDGE=true`, todas as demais flags de moderação `false`; confirmar `GET /health=200`, `POST /admin/config=503`, e `POST /qa/firebase-fixture` anônimo `401`.
- [ ] Enquanto o intervalo ainda estiver aberto, executar no Termux `python scripts/qa-auth-termux.py --test --bridge-remote` com conta sintética nova, exigir `QA_BRIDGE_REMOTE_PASS`, `QA_TEST_RESULT: PASS` e `QA_TEST_ACCOUNT_REMOVED: YES`. Não compartilhar e-mail, senha, token nem API key.
- [ ] Confirmar consumo de no máximo **uma reserva D1 adicional** para o teste positivo, sem ultrapassar 12/dia, e verificar o bloqueio por janela expirada. Mesmo com autoexpiração, **restaurar a versão QA com ponte=false** e confirmar pela versão ativa na Cloudflare, não pelo endpoint de configurações da última versão.
- [ ] Documentar resultado negativo de token forjado e limite de requisições sem revelar payload; 429/503 são bloqueios, **não** aprovação de leitura autorizada.

**Observação:** não liberar a ponte pública em uma sessão desassistida; uma janela de 10 minutos de autorização interna não substitui rate limits/D1 reais nem o rollback. Uma janela vencida deve negar toda leitura mesmo que alguém esqueça a flag ligada.

## Trava B — identidade de servidor e custo zero
- [x] Checagens no código de projeto fixo, identidade dedicada, aprovações independentes, chave/conta trocada não reutiliza cache de token.
- [ ] Selecionar um **método de identidade sem chave permanente** que funcione no ambiente de execução escolhido e comprovar sua autenticação por teste. Google Workload Identity Federation depende de credencial emitida por um provedor externo confiável; o OIDC de GitHub Actions atualmente usado na CI de QA **não é credencial permanente do Worker Cloudflare**.
- [ ] Verificar com as fontes oficiais as cotas, requisitos de billing e eventual custo do desenho escolhido. Se não for demonstradamente viável no orçamento disponível, **não implantar**. Não afirmar preço zero sem comprovação.
- [ ] Obter parecer sobre permissões realmente mínimas por operação: ler posts, replies, denúncias e admins; gravar apenas cases, audit, notices, estado de varredura e operações restritas de quarentena/revisão. **O papel IAM `roles/datastore.user` é amplo e não restringe por coleção.** O acesso de servidor ao Firestore ignora as Security Rules do APK; não considerá-las compensação para um papel amplo.
- [ ] Validar em projeto isolado bloqueio de identidade de outro projeto, revogação, rotação e falta de permissões; não criar chave JSON ou conceder papéis no Firebase oficial antes de aprovação específica.

## Trava C — liberação gradual e rollback
- [ ] Prática completa em QA de criação atômica de caso, trilha de auditoria e aviso, revisão humana, recursos, falhas de transação, sem publicação/quarentena real de contas de usuários.
- [ ] Confirmar sem dúvida quem são os moderadores autorizados, o comportamento dos painéis Android Debug e dos recursos; negar acesso a qualquer usuário comum.
- [ ] Revisar a PR #44, risco de permissões, testes, custo e backups; manter `main` e release intocados até autorização explícita.
- [ ] Inicialmente ativar somente classificação/aviso com `HOLD_ENABLED=false`, sem excluir conteúdo; verificar incidentes, limites e capacidade de desligar imediatamente.
- [ ] Qualquer retenção/quarentena exige aprovação **separada**, testes supervisionados e mecanismo de reversão, incluindo integridade de respostas.

## Estado em 30/10/2026
- CI [41085456817](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41085456817): testes integrais da correção anterior concluídos com sucesso.
- Antes desta alteração, Worker QA ativo: versão `b76a79ec-01cc-4a01-9801-a2eb957a07f1` (v17), ponte/moderação/HOLD **false**, modo QA **true**; D1 = 3 reservas usadas em 30/10/2026.
- Timebox é novo no código da branch `feature/guardiao-autonomo-20261029` (commit `65afa5b694128b0d62c1f4c153775d4f20544297`), ainda não implantado em Cloudflare, aguardando resultado da CI.
- Nenhuma validação remota do Worker com Firebase ID token válido foi concluída.
- Referências: https://docs.cloud.google.com/iam/docs/workload-identity-federation ; https://firebase.google.com/docs/firestore/security/iam ; https://developers.cloudflare.com/workers/runtime-apis/fetch/ .

**GO para produção:** somente quando TODOS os itens pendentes estiverem comprovados e houver nova autorização expressa. Até então: **NO-GO**.
