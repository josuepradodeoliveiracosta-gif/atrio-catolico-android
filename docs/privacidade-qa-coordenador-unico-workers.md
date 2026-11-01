# Privacidade — coordenador comum a Avatar, Guardião e Push (QA, sem produção)

**PR #98 · projeto demonstrativo `demo-atrio-v11` · conta real NÃO é permitida.**

## Etapa concluída no código de testes

O módulo `qa-shared-freeze-coordinator.js` usa uma única base SQLite persistente de testes (a mesma `qa-privileged-freeze-schema.sql` de dois usuários fictícios) para admitir todas as operações por UID em **uma operação SQL atômica**. As rotinas `beginFreeze` e `finalizeFreeze` consultam a mesma tabela de tickets, independentemente de qual Worker iniciou a operação.

Os executáveis originais `avatar-worker/src/index.js`, `guardian-worker/src/index.js` e `push-worker/src/index.js` aceitam o **modo excepcional** `ATRIO_PRIVACY_QA_SHARED_MODE`. Quando há qualquer valor de ativação, **todas as rotas normais e operações agendadas/fila ficam bloqueadas** nesse processo: nenhuma chamada Firebase, Cloudinary, FCM, GitHub, IA ou D1 real deve começar. O único exercício permitido usa URL fixa `https://qa-only.invalid/__qa/shared-freeze/<service>` (serviço é codificado no próprio Worker), sinalizador exato `true`, fixture `demo-atrio-v11`, adaptadores injetados e *nenhum* segredo ou binding real. Essa URL é fictícia e **não deve ser implantada**.

O teste `qa-shared-freeze-workers.test.js` usa os **três Workers originais** e um só ledger de SQLite em memória, verificando que:
- congelar Alice bloqueia **simultaneamente** Avatar, Guardião e mensagens Push que envolvam Alice;
- Bob permanece ativo quando o efeito só usa Bob;
- congelar Bob também bloqueia Push quando ele é destinatário de Alice;
- um efeito Avatar em andamento bloqueia o freeze final e novas admissões Guardião/Push;
- falha de envio ou confirmação negativa deixa o ticket pendente e impede finalizar exclusão;
- UIDs, campos, URLs e tópicos diferentes do fixture são recusados antes de qualquer mutação;
- tarefas agendadas do Guardião e filas Push são interrompidas sem acesso a segredos;
- credenciais e bindings reais presentes no mesmo ambiente provocam bloqueio antes de leitura.

## Próxima etapa automática: concorrência, falhas e recuperação

A suíte de QA inclui simultaneidade, ticket em andamento, falha ambígua e tentativa de finalizar freeze com operações ainda em voo. O passo seguinte verifica reinício do processo e **conexões distintas ao mesmo ledger SQLite local**: os tickets incompletos devem persistir, a falha precisa ser reconciliada antes de desbloquear e um segundo Worker não pode obter uma permissão depois de `draining`.

## Limitações fundamentais

Isto NÃO é um backend Cloudflare autenticado ou implantado, e **não** é uma proteção individual de produção. O coordenador é uma função JS que recebe um banco SQLite de testes. Ainda faltam:

- serviço de coordenação acessível exclusivamente aos três Workers via Service Binding seguro, com autenticação de serviço e IAM mínimo;
- armazenamento central realmente durável em ambiente segregado de Cloudflare (D1/DO), política de retry e fencing com geração;
- integração dos **caminhos normais de escrita** (e não apenas das entradas QA) com esse serviço, incluindo REST Firestore, Cloudinary, FCM, bot, tarefas agendadas e tópicos;
- reconciliação auditável por operador autorizado, inclusive efeitos já aceitos por terceiros;
- testes com versões implantadas, plano de rollback, portal público HTTPS de exclusão e executor real de limpeza;
- revisões e evidências da Google Play, ainda com `releaseAuthorized:false`.

**Jamais configurar `ATRIO_PRIVACY_QA_SHARED_MODE` na produção.** Produção, `main`, backups, assinatura e OTA preservados. A PR #98 deve continuar em rascunho e a issue #72 continua bloqueadora.
