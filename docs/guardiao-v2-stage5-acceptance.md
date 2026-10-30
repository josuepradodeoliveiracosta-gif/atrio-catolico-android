# Átrio Guardião V2 — Etapa 5: critérios objetivos para ativação oficial

## Checkpoint operacional consolidado — 30/10/2026 (não repetir testes já aprovados)

**Último código:** branch `feature/guardiao-autonomo-20261029`, PR #44 ainda **DRAFT**; `main`, backup, Firebase oficial, Workers Push/Avatar e APK Release não são alvo desta etapa.

- **Concluído:** [Android Emulator 41135378102](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41135378102) = `completed/success` na revisão `0ffb9ed4`, e [CI 41136296289](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41136296289) = sucesso nos seis jobs principais. Não rerodar essas mesmas revisões.
- **Novo e ainda sem homologação instrumentada:** na revisão `d2d2df1e`, testes Android de decisão administrativa positiva, contestação única do autor e ocultação de avisos privados após logout. [UI 41137036410](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41137036410) estava `pending` na última consulta; não confundir compilação `assembleDebugAndroidTest` com execução dos testes em Android virtual.
- **CI da revisão mais recente:** [41137036394](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41137036394) havia aprovado motor, REST, regras Firestore, consultas QA e smoke; a compilação Android ainda estava em andamento. Verificar desfecho antes de marcar a revisão completa como aprovada.
- **Custo zero ainda não comprovado:** consulta read-only à conta Cloudflare retornou `200` para Workers Account Settings (`default_usage_model=standard`), mas `403` para assinaturas e uso de cobrança, não permitindo afirmar Workers Free. Plano Firebase Spark real também não foi confirmado. Nenhuma alteração de faturamento foi feita.
- **Próximas ações únicas:** (1) ler resultado final do UI da revisão `d2d2df1e` e corrigir só falhas reais; (2) confirmar Spark + Workers Free e cotas reais em cada painel, sem vincular billing; (3) revisar exclusivamente o delta da PR #44 e obter autorização específica antes de qualquer integração supervisionada.
- **Não fazer nesta fase:** ativar cron de moderação real, quarentena automática, ponte QA permanente, IAM/chave JSON, Cloud Run/Blaze, merge, deploy em produção, publicação assinada ou edição de backup. Autonomia 24/7 permanece `NO-GO`.

**Política obrigatória:** [custo zero, sem assinatura ou faturamento](guardiao-v2-custo-zero-obrigatorio.md). **Qualquer tecnologia que exija plano pago, cartão, Cloud Billing, Blaze, contratação ou risco de cobrança fica automaticamente descartada, ainda que ofereça free tier.**

**Situação: NÃO APROVADO para produção.** Este arquivo é um roteiro operacional, não uma permissão para deploy, IAM ou faturamento. O projeto ainda está em pré-lançamento e a PR #44 permanece **draft**. Não alterar `main`, APK Release, backups, regras Firebase oficial nem os Workers de Push/Avatar sem autorização expressa.

## Trava A — ligação entre Firebase QA e Cloudflare QA
- [x] Cadastro de conta QA temporária e remoção, Auth + Firestore Rules, token Firebase ID verdadeiro no Termux.
- [x] Execução **local** da implementação da ponte com token real (`QA_BRIDGE_LOCAL_PASS`), D1 e rate limiting simulados.
- [x] Worker QA remoto recusa requisições sem token (401), mantém admin fechado (503); D1 QA restringe tentativas; nenhum usuário real foi moderado.
- [x] Correção do `fetch` do Worker: `redirect: manual`, rejeição explícita de 3xx, sem redirecionar Bearer.
- [x] **Código na branch de testes** exige `GUARDIAN_V2_QA_BRIDGE_NOT_BEFORE` e `GUARDIAN_V2_QA_BRIDGE_EXPIRES_AT`, ambas ISO 8601 UTC, com janela **até 10 minutos**; fora do intervalo recusa antes de D1/Firebase e confere novamente depois da reserva D1.
- [x] Implantar o código com essas duas variáveis **vazias** no Worker QA, mantendo `GUARDIAN_V2_QA_FIRESTORE_BRIDGE=false`, sem acesso ao Firebase oficial. A versão QA v19 `d73bf7c4-5857-4181-af4b-ca7e3385e142` foi conferida por API com 100% do tráfego.
- [x] Smoke HTTP independente da v19 concluído: chamadas anônimas e com JWT sintético devolvem `503 qa_bridge_disabled`; administração e revisão retornam `503 qa_read_only`. Job Cloudflare QA [41092075372](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41092075372), log com `GUARDIAN_QA_V19_BRIDGE_DISABLED_REMOTE_HTTP_PASS`. D1 permanecia em 3/12 reservas (30/10).
- [ ] Com nova autorização/coordenação de teste, habilitar temporariamente **apenas QA** com um intervalo literal curto, em versão separada, `GUARDIAN_V2_QA_FIRESTORE_BRIDGE=true`, todas as demais flags de moderação `false`; confirmar `GET /health=200`, `POST /admin/config=503`, e `POST /qa/firebase-fixture` anônimo `401`.
- [ ] Enquanto o intervalo ainda estiver aberto, executar no Termux `python scripts/qa-auth-termux.py --test --bridge-remote` com conta sintética nova, exigir `QA_BRIDGE_REMOTE_PASS`, `QA_TEST_RESULT: PASS` e `QA_TEST_ACCOUNT_REMOVED: YES`. Não compartilhar e-mail, senha, token nem API key.
- [ ] Confirmar consumo de no máximo **uma reserva D1 adicional** para o teste positivo, sem ultrapassar 12/dia, e verificar o bloqueio por janela expirada. Mesmo com autoexpiração, **restaurar a versão QA com ponte=false** e confirmar pela versão ativa na Cloudflare, não pelo endpoint de configurações da última versão.
- [ ] Documentar resultado negativo de token forjado e limite de requisições sem revelar payload; 429/503 são bloqueios, **não** aprovação de leitura autorizada.

**Observação:** não liberar a ponte pública em uma sessão desassistida; uma janela de 10 minutos de autorização interna não substitui rate limits/D1 reais nem o rollback. Uma janela vencida deve negar toda leitura mesmo que alguém esqueça a flag ligada.

## Trava B — identidade de servidor e custo zero
- [x] Checagens no código de projeto fixo, identidade dedicada, aprovações independentes, chave/conta trocada não reutiliza cache de token.
- [ ] Selecionar um **método de identidade sem chave permanente** que funcione no ambiente de execução escolhido e comprovar sua autenticação por teste. Google Workload Identity Federation depende de credencial emitida por um provedor externo confiável; o OIDC de GitHub Actions atualmente usado na CI de QA **não é credencial permanente do Worker Cloudflare**.
- [ ] Comprovar em fontes oficiais e na conta concreta que o desenho **não exige conta de faturamento, cartão, upgrade, plano pago ou cobrança possível**, e respeita cotas free. Não basta estar dentro de uma faixa gratuita em produto que exija billing. Se faltar essa prova, **NO-GO**, sem exceção.
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

## Nova versão QA segura — 30/10/2026
- Commit fonte `752fdf251515d5bd24e4fd3f1145bdba235fad4b`: data UTC canônica, janela máxima de 10 minutos e falha fechada. GitHub Actions [41090114698](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41090114698): **success** para os 6 jobs efetivos; jobs remotos opcionais ignorados, conforme o desenho.
- Worker `atrio-guardian-v2-qa` versão **19**, ID `d73bf7c4-5857-4181-af4b-ca7e3385e142`, criado a partir de 10 módulos da branch, com **100% do tráfego QA** confirmado por `GET /deployments` (deployment `e5e9320c-2f8b-4a2d-b565-3496eb9fcef2`).
- Configuração lida por API: `GUARDIAN_V2_TEST_MODE=true`, `GUARDIAN_V2_ENABLED=false`, `GUARDIAN_V2_HOLD_ENABLED=false`, `GUARDIAN_V2_QA_FIRESTORE_BRIDGE=false`, início e fim da janela **vazios**, dispatch desativado, limitadores QA e D1 exclusivo existentes; nenhum binding de segredo.
- Versão anterior segura para eventual rollback: v17 `b76a79ec-01cc-4a01-9801-a2eb957a07f1`. Não restaurar versões temporárias que tenham ponte habilitada.
- Workflow de smoke remoto foi provocado por alteração isolada em `.github/workflows/guardiao-qa-remote-smoke.yml`, commit `907c622bd86d9b2508b516e2bf4e02a4e87a76d6`; **verificar resultado antes de afirmar aprovação HTTP**. Nenhum token QA real enviado, nem moderação do Firebase oficial ativada.
- A ponte com token QA verdadeiro, IAM de servidor, custo zero comprovado, moderação contínua e produção permanecem **NO-GO**. `main`, backups, Workers Push/Avatar, regras oficiais e APK Release intocados.

## Evidência da Trava A, smoke negativo final (30/10/2026)
- Revisão `9be24a423a6bc7e22244953e5ba68ff810eed08d` adicionou à CI testes HTTP remotos sem segredos e sem escrita: `GET /health` retornou `200 guardian_v2_qa_safe`; `POST /qa/firebase-fixture` sem token e com JWT falso retornou `503 qa_bridge_disabled`; `POST /admin/config` e `POST /admin/review` retornaram `503 qa_read_only`.
- O job `Cloudflare QA — health e acesso negado` da execução [41092075372](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41092075372) terminou `success`, com marca `GUARDIAN_QA_V19_BRIDGE_DISABLED_REMOTE_HTTP_PASS` no log. Isso **confirma bloqueios remotos**, mas não comprova autenticação positiva Firebase QA nem serviço 24/7.
- Estado da Cloudflare reconfirmado depois do smoke: versão QA v19 `d73bf7c4-5857-4181-af4b-ca7e3385e142`, **100% de tráfego**, e D1 QA `2026-10-30: used=3` (sem aumento). Nova janela de token QA legítimo **não foi aberta**. Produção continua `NO-GO`.

## Bloqueio definitivo da chave JSON em produção (pré-lançamento)
- O código anterior de `src/firestore.js` aceitava assinar um OAuth JWT com chave privada de conta de serviço caso as flags de produção e identidade estivessem ativadas. Esse desenho não atende à meta de credencial sem chave permanente.
- Commit `5fdefa5b`: após as verificações de projeto e aprovação, a função `token()` recusa **sempre** o projeto literal `atrio-catolico` com `production_key_auth_disabled`, **antes** de qualquer assinatura, cache ou chamada externa, mesmo quando as duas flags de aprovação são verdadeiras e o JSON parece válido. A rota de QA existente permanece separada e desligada no Worker publicado.
- Commit `c55ee0fb`: teste regressivo com conta e chave **fictícias**, flags de aprovação ligadas e `fetch` interceptado. A suíte offline [41094718909](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41094718909) confirmou o novo teste e o motor (159/159 testes Node), QA offline (12/12) e preflight QA; execução finalizada com **success** nos seis jobs efetivos, incluindo Android Debug, regras e integração REST; dois jobs opcionais permaneceram skipped por segurança.
- **Caminho Google Cloud Run DESCARTADO por restrição financeira:** embora possa oferecer free tier e identidade efêmera, serviços Google Cloud exigem faturamento habilitado. A exigência de custo zero sem vínculo de billing prevalece; não implantar Cloud Run, Cloud Scheduler, nem pedir cartão ou ativar Blaze. Encontrar alternativa comprovadamente disponível em plano 100% gratuito e sem faturamento antes de habilitar a moderação autônoma.
- **Alternativa externa a estudar:** Workload Identity Federation exige um provedor de identidade que emita credenciais para a execução concreta; o OIDC temporário do GitHub Actions não autentica automaticamente um Worker Cloudflare em operação contínua.
- A identidade de servidor OAuth bypassa as Firestore Security Rules de clientes. Nenhum papel IAM deve ser aplicado sem teste de mínimo privilégio no projeto QA; uma verificação do código não substitui limites de autorização do Google.
- Nenhum deploy, chave, identidade IAM, configuração de billing, moderação real ou alteração no projeto `atrio-catolico` foi realizado.

Fontes oficiais:
- https://docs.cloud.google.com/run/docs/securing/service-identity
- https://docs.cloud.google.com/iam/docs/workload-identity-federation
- https://firebase.google.com/docs/firestore/use-rest-api
- https://firebase.google.com/docs/firestore/security/iam
- https://cloud.google.com/run/pricing


## Etapa 5 — alternativa gratuita de moderação humana validada (30/10/2026)

- **Prova técnica de alternativa sem identidade de servidor:** `tests/security/guardian-v2-free-mode-emulator.mjs` executa somente SDK Firebase Auth + Firestore Security Rules no emulador (sem conta de serviço, IAM, Cloudflare ou API paga). Em [CI 41099380893](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41099380893), job `Regras e recursos do Guardião no emulador` aprovado: **15 casos de permissões + 7 casos do modo gratuito**. Confirma denúncia autenticada, sigilo, remoção humana de resposta com decisão na **mesma transação**, arquivamento sem exclusão, proteção contra falsificação de caso e revogação administrativa.
- Proteção preventiva local `GuardianPreflight` e fila de denúncias existente em `ModerationScreen` podem formar um **modo inicial supervisionado** dentro do Firebase Spark, respeitando as cotas; a implementação foi apenas testada em QA e **não constitui ativação oficial**.
- `cloudflare/guardian-worker/scripts/check-zero-cost-qa.py` verifica de modo conservador isolamento do Worker QA, flags inativas, ausência de segredo Firebase, limitadores e D1 QA fixo. Teste de mutação `test-zero-cost-qa.py` rejeitou **12 configurações inseguras** na CI do motor. Isso valida a *configuração versionada*, não comprova o plano de billing efetivo da conta.
- **Autonomia 24/7 continua NO-GO.** `firestore.rules` exige `signedIn()` para posts e replies, `isAdmin()` para reports. O Cron Cloudflare anônimo não pode ler dados restritos nem receber permissão de escrita só por possuir cron; tornar a base pública ou embutir credenciais permanentes é proibido.
- Documentação operacional: [modo gratuito supervisionado](guardiao-v2-operacao-gratuita-supervisionada.md). Fontes oficiais: [Firebase Spark](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [REST e regras](https://firebase.google.com/docs/firestore/use-rest-api), [Cloudflare Free](https://developers.cloudflare.com/workers/platform/limits/) e [D1 bloqueia excessos no Free](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/).
- Pendente: conferir planos reais das contas, validar testes de UX no aparelho, revisar a PR, autorizar lançamento inicialmente **apenas supervisionado** e decidir um mecanismo permanente e gratuito para automação real. Não criar conta de faturamento, alterar `main`, Firebase oficial, APK Release, Workers Push/Avatar ou backups sem autorização.
