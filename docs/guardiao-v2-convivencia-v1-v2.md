# Átrio Guardião — convivência V1 / V2 sem moderação duplicada

**Escopo:** auditoria estática das árvores do GitHub em 30/10/2026. **Não há implantação nem autorização de ativação neste documento.**

## Dois produtores de casos, não duas cópias descartáveis

| Característica | Guardião V1 (no push-worker) | Guardião Autônomo V2 (guardian-worker) |
| --- | --- | --- |
| Entrada | `POST /moderation/event`, disparado pelo cliente depois da escrita | Varredura paginada do Firestore; inclui alterações de `updatedAt` em posts e denúncias |
| Motor | `classifyGuardiao`, IA opcional e limites D1 | `classify` + `decide`, sem obrigação de IA externa |
| Registro de análise | `reports/{guard_<hash>}` e fila já existente | `guardian_cases/{guard_<hash>}`, `guardian_audit`, `guardian_notices` |
| Quarentena | `guardiao_quarantine/{caseId}`, flag `GUARDIAO_AUTOHIDE_ENABLED` | **Mesmo namespace** `guardiao_quarantine/{caseId}`, mas ID e fluxos de revisão são diferentes; só com `GUARDIAN_V2_HOLD_APPROVED` e demais travas |
| Revisão | Rotas existentes no `atrio-push` e painel `ModerationScreen` | `/admin/review`, `GuardianCaseOverview` e avisos V2 |
| Ativação | `GUARDIAO_ENABLED` no ambiente do *push Worker* | `GUARDIAN_V2_ENABLED` e aprovações no ambiente V2 |
| Estado conhecido | No `cloudflare/push-worker/wrangler.toml` versionado: `GUARDIAO_ENABLED=false` | Código V2 preparado, sem identidade keyless de executor recorrente de produção homologada |

**Atenção:** os arquivos de configuração do Git **não comprovam** as variáveis implantadas nos Workers remotos. O estado real deve ser examinado somente com autorização e sem publicar segredos.

## Redundâncias que seriam prejudiciais

1. **Dupla triagem independente:** se V1 e V2 estiverem ativos, uma mesma mensagem pode entrar tanto em `reports` como em `guardian_cases`, com rótulos e prazos divergentes. A verificação de repetição de cada motor não deduplica o outro.
2. **Dupla decisão sobre o mesmo conteúdo:** ambas as versões possuem lógica de quarentena e revisão, mas usam convenções de ID diferentes. Um operador não deve interpretar os dois registros como confirmação independente da culpa.
3. **Execução concorrente desnecessária:** manter scanner paginado e webhook V1 como produtores simultâneos duplica consultas, filas e manutenção, sem aumentar proporcionalmente a segurança.
4. **Padrões de detecção diferentes:** V1 e V2 usam classificadores distintos. Não unir o resultado como voto automático: divergência significa encaminhamento humano, não autorização para retirar conteúdo.

## Diretriz de migração recomendada

1. **Inventário prévio:** conferir flags efetivamente implantadas, identidades, regras e relatórios em ambiente aprovado; evitar coleta ou cópia de mensagens privadas.
2. **Um produtor ativo por vez:** preservar V1 como histórico/caminho de rollback **desativado** enquanto o V2 estiver sendo testado; não ligar os dois processadores. Um eventual rollout precisa de controle operacional explícito fora do APK.
3. **Fase V2 somente triagem:** scanner limitado, sem `allowHold`, sem exclusão, sem banimento e sem IA punitiva. As detecções seguem para revisão humana.
4. **Preservar dados e recursos:** não migrar, apagar ou alterar automaticamente `reports`, `guardian_cases`, `guardiao_quarantine` ou recursos existentes. Exibir origem claramente na administração e preservar o direito de contestação.
5. **Provas antes do rollout:** mesmas mensagens sintéticas avaliadas nas duas versões em laboratório; confirmar que há um único produtor em cada execução, sem duplicação de caso e com registro de auditoria. Testar edit, empate de timestamp, reinício, concorrência e revogação de administrador.
6. **Rollback sem efeito dominó:** desligar **o produtor V2** e suspender o job que lê Firestore, sem reativar automaticamente o V1, sem remover dados de auditoria ou apagar conteúdo.
7. **Gates obrigatórios:** autorização separada para IAM/WIF, quotas de leitura, regras oficiais, publicação Android, rollout, custo e eventual retenção.

## Arquivos em que o comportamento está implementado

- `cloudflare/push-worker/src/index.js`: `classifyGuardiao`, `handleGuardiaoEvent`, `guardiaoAutoHoldAllowed`, `handleGuardiaoReview`.
- `cloudflare/guardian-worker/src/index.js`: `processDocument`, `processReport`, `scanOnce`, `settingsOf`, `reviewCase`.
- `cloudflare/guardian-worker/src/scan-paged.js`: varredura de posts, respostas, edições e denúncias com checkpoints.
- `firestore.rules`: controle de relatórios, quarentena, casos, avisos e auditoria do Guardião.
- `app/src/main/java/br/com/atriocatolico/ModerationScreen.kt`: administração humana do fluxo legado; `GuardianCaseOverview.kt`: leitura dos casos V2.

**Decisão desta PR:** corrigir apenas duplicações offline e documentais, **sem deletar V1**, sem reconfigurar Worker/Firebase e sem alterar backups. A escolha e ativação de um produtor canônico ficam para uma autorização posterior.
