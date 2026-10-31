> **EVIDÊNCIA COMPLEMENTAR — PR #71:** a execução GitHub Actions [41244872777](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41244872777) terminou com sucesso. A tarefa `bundlePlayRelease` compilou o AAB **sem assinatura de produção**; o verificador do manifesto mesclado confirmou Android API 36, `br.com.atriocatolico`, ausência do instalador APK/OTA e build não depurável. A PR #71 continua rascunho, não mesclada, e esse resultado **não** valida a assinatura, a Play Console ou a exclusão de contas. Não duplicar a variante Play dentro da PR #98.

# Átrio Católico — auditoria ampliada de privacidade, Cloudflare e Google Play

**31/10/2026 | PR #98, em rascunho | evidências de inspeção somente leitura + testes offline**

**Objetivo:** evitar repetir um mesmo teste de aprovação e mapear *controles independentes* de segurança. Nenhuma operação de exclusão real foi autorizada por estes resultados. A infraestrutura Cloudflare usada para o ensaio está **na mesma conta administrativa** que os Workers existentes, embora os recursos sejam segregados.

## 1. Cloudflare real (somente leitura nesta rodada)

| Controle independente | Resultado | Limite da evidência |
| --- | --- | --- |
| 1. Sete Workers de homologação existentes e implantados | Aprovado | Não prova IAM isolado em conta independente |
| 2. `workers.dev` desativado em todos os sete | Aprovado | Não substitui inspeção de domínio customizado |
| 3. URLs de pré-visualização desativadas | Aprovado | Estado verificado no provedor |
| 4. Gatilhos cron ausentes nos sete Workers | Aprovado | Smoke foi desativado após executar |
| 5. Nenhuma rota de zona da conta conecta QA a público | Aprovado (zero zonas na conta consultada) | Se outra zona/conta for vinculada, reavaliar |
| 6. Nenhum domínio de Worker customizado na conta consultada | Aprovado (zero domínios) | Snapshot, não monitoramento contínuo |
| 7. Serviço central tem apenas o D1 de estágio como recurso de dados | Aprovado | Não garante que toda operação de produção passe pelo serviço |
| 8. Cinco papéis HMAC distintos registrados no central | Aprovado (nomes, não valores) | Não é auditoria de força do segredo já armazenado |
| 9. Cada consumidor tem só um Service Binding ao central e um segredo próprio | Aprovado | Não comprova proteção por UID real |
| 10. Worker de smoke tem cinco Service Bindings e D1 dedicado | Aprovado | Uso exclusivo de fixtures |
| 11. Última implantação de cada Worker usa 100% uma versão | Aprovado | Versões históricas continuam disponíveis no provedor |
| 12. Quatro Workers preexistentes sem flags, segredos ou bindings de freeze QA | Aprovado na configuração remota | Não equivale a proteger a produção: eles continuam sem fence por conta |

Nenhum identificador de conta, credencial ou valor de segredo é registrado nesta documentação.

## 2. Banco D1 remoto de fixtures

| Controle independente | Resultado |
| --- | --- |
| 13. Nome do banco exclusivo confirmado | Aprovado |
| 14. Tabelas `qa_privileged_accounts`, `qa_privileged_operations`, `qa_stage_nonces` existem | Aprovado |
| 15. Ambos os `CHECK(uid IN ('qa-freeze-alice','qa-freeze-bob'))` presentes | Aprovado |
| 16. Exatamente duas contas fictícias, ambas `active` | Aprovado |
| 17. Zero operações/tickets em aberto após smoke | Aprovado |
| 18. Zero tickets órfãos segundo LEFT JOIN com contas | Aprovado |
| 19. Nonces exclusivos, sem duplicatas: oito após smoke | Aprovado |
| 20. Registro de uma única execução com `status='passed'` | Aprovado |
| 21. `PRAGMA integrity_check` / `foreign_key_check` via REST D1 | **Não verificado: API retornou `SQLITE_AUTH`** |

A proibição da API de executar determinados `PRAGMA` não deve ser interpretada como sucesso do exame de integridade física. Os controles 14–20 são resultados de consultas `SELECT` e verificação de schema.

## 3. Fluxos efetivos de Avatar, Guardião e Push

A fonte `cloudflare/account-deletion-audit/src/qa-worker-coverage-contract.js` lista **15 entradas privilegiadas** que estão `state:'not_integrated'`. O ensaio real via HMAC envolveu **consumidores separados de fixture**, não os caminhos de escrita dos Workers oficiais.

- Avatar: 5 rotas/entradas sem freeze de produção demonstrado.
- Guardião: 3 entradas sem freeze de produção demonstrado.
- Push: 7 entradas sem freeze de produção demonstrado.
- Lacunas abertas adicionais: 10 temas documentados, incluindo rollback Cloudinary, fanout, FCM, D1, crons, retries e versões antigas implantadas.

**Correção nesta PR:** `scripts/play_closed_track_status.mjs` agora inclui `workerMutationCoverage` por serviço, número de caminhos não protegidos e rótulos das lacunas, além de um bloqueio explícito. Nenhuma homologação de stage pode reduzir essas contagens até que os caminhos reais estejam integrados, testados e revisados.

## 4. Android, AAB e política Google Play

| Critério | Estado na PR #98 | Existe proposta na PR #71? |
| --- | --- | --- |
| 22. Android `targetSdk` 36 para novas submissões em 2026 | **Não**, PR #98 usa 35 | **Sim**, PR #71 usa 36; ainda rascunho |
| 23. Remover `REQUEST_INSTALL_PACKAGES` do AAB Play, preservando OTA fora da loja | **Não comprovado**: permissão está no manifesto principal e não há overlay Play na PR #98 | **Sim**, overlay `playRelease` com `tools:node='remove'`; ainda não integrado |
| 24. Pacote oficial preservado `br.com.atriocatolico` | Confirmado na configuração | Mesmo `applicationId` previsto na PR #71 |
| 25. Assinatura permanente preservada, sem recriação de chave | Não se alterou assinatura | Workflow manual da PR #71 exige confirmação, branch main, nove evidências, versão acima de 35 e secrets existentes; **assinatura não executada aqui** |
| 26. AAB para Play compilado, inspecionado e assinado | **Não comprovado na PR #98** | PR #71 contém CI do AAB **sem assinatura**, que não publica |
| 27. Política pública e Segurança dos dados | Minutas internas não publicadas | Play Console e web pública pendentes |
| 28. Recurso externo público HTTPS para solicitar exclusão | Ainda sem URL homologada | Pendente |
| 29. Exclusão real Auth/Firestore/Cloudinary/FCM/D1 | Somente simulador e executor de fixture | Pendente |
| 30. Nove evidências com revisor, data e URL | 0 de 9 verificadas, `releaseAuthorized=false` | Gate de assinatura exige todas |

A política Google Play exige um caminho de exclusão **no app e pela web**, e apagar dados associados: congelar a conta não é exclusão. A partir de 31/08/2026, novos apps Android convencionais direcionam API 36 ou superior. A permissão `REQUEST_INSTALL_PACKAGES` não é apropriada para autoatualização de um app de comunidade via Play Store. Os requisitos de 12 testadores contínuos por 14 dias se aplicam **à solicitação de acesso à produção** para determinadas contas pessoais novas, não são pré-requisito para iniciar a faixa fechada.

Fontes oficiais:
- https://support.google.com/googleplay/android-developer/answer/13327111
- https://developer.android.com/google/play/requirements/target-sdk
- https://support.google.com/googleplay/android-developer/answer/12085295
- https://support.google.com/googleplay/android-developer/answer/14151465

## 5. Priorização sem retrabalho

1. Não recriar a homologação de stage: o Service Binding HMAC remoto **já passou** e os cron jobs estão removidos.
2. Em vez de duplicar correções do AAB na PR #98, revisar e consolidar **a PR #71** (API 36/overlay Play) quando houver integração deliberada. Verificar a assinatura do certificado e manter os APKs OTA existentes sem surpresas.
3. Trabalhar o **bloqueio real das 15 entradas privilegiadas** antes de habilitar qualquer exclusão. Exigir auditoria de fanout, semântica de retries e efeitos externos não reversíveis.
4. Desenvolver portal HTTPS funcional, política de privacidade revisada, retenção e executor de exclusão com reconciliador auditável; testar em ambiente segregado antes de um deploy dos Workers oficiais.
5. Somente depois executar testes Play Console/AAB assinado e preencher evidências; sem confundir sucesso de CI com política publicada.

**Limites:** Não foram verificados `PRAGMA integrity_check`, conteúdo da chave privada, logs históricos de produção, certificado de app signing Google Play, configuração do Play Console, links públicos de exclusão ou serviço administrativo de exclusão real. Nenhum desses controles deve ser declarado aprovado.

**Preservados:** `main`, chaves e assinatura, OTA, backups, Workers preexistentes e dados de usuários.
