# Átrio Guardião V2 — varredura paginada e retomável (QA)

**Estado:** implementada e testada na branch `feature/guardiao-autonomo-20261029`. **NÃO ativar em produção sem autorização.** Sem novos serviços, billing, mudanças em `main`, backups, Worker Push ou regras públicas.

## O que mudou no código

- `Firestore.scanPage` consulta páginas por `createdAt DESC` e `__name__ DESC`. Usa um cursor composto `{time,name}` para não perder documentos com carimbos de data idênticos, `startAt.before=false` (equivalente a `startAfter`) e busca `max+1` resultados para sinalizar se há mais páginas.
- `scanPagedCycle` lê `posts`, `replies` (collection group) e `reports`. Em cada execução, aceita no máximo **2 páginas por grupo** de 30/30/15 resultados — até 150 registros examinados no total.
- Antes de consultar uma janela, grava seu início/fim no documento privado `guardian_runtime/scan_<group>`. Depois de cada página processada com sucesso, grava a posição de retomada por precondição de versão (`updateTime`). Caso haja erro em documento, consulta ou checkpoint, **não avança além do lote malsucedido**; a próxima execução volta a essa página.
- A janela inicial é dos **20 minutos anteriores**. Quando uma janela termina, a seguinte começa no final da anterior com **sobreposição de 1 segundo**, sem saltar intervalos por causa de períodos de grande movimento ou indisponibilidade temporária.
- Os novos indicadores `backlogGroups` e `pausedGroups` em `guardian_runtime/last_scan` distinguem trabalho acumulado e grupos interrompidos por erro. O processo nunca força processamento ilimitado em uma única execução.
- O scanner antigo sem `scanPage` continua disponível para dublês de teste e compatibilidade, mas o adaptador REST normal usa a implementação paginada.

## Validação realizada

- **90/90 testes do motor** e **12/12 do QA Cloud Run** concluídos no CI da revisão.
- O **Firestore Emulator** processou 65 publicações sintéticas com mesmo `createdAt`: 60 na primeira varredura, 5 na seguinte, sem perda; a conferência verificou que o checkpoint intermediário estava em `running` e terminou em `complete`.
- A Firestore Rules bloqueou clientes autenticados de consultar o documento privado de checkpoint.
- O caminho da consulta QA remota `scanQa` continua estritamente somente leitura e **não usa** o scanner paginado com escrita; nenhuma configuração remota foi alterada.
- Executar novamente CI ao alterar os índices ou mecanismo de paginação: `npm test` em `cloudflare/guardian-worker` e `npm run test:guardian-shadow` em `tests/security`.

## Limites e riscos restantes

1. **A fila de backlog pode crescer** quando entram mais documentos por ciclo do que a cota de páginas comporta. O código retoma e registra o atraso, mas **não garante latência de moderação** nem 100% de cobertura sob todos os padrões de uso.
2. O índice **collection-group `replies` por `createdAt DESC` e `__name__ DESC`** e os demais índices de pesquisa devem ser verificados no projeto alvo antes de liberar qualquer backend real. O emulador não garante que um índice de produção esteja disponível. Não efetuar deploy automático de índices.
3. As publicações editadas após terminar sua janela não são redescobertas automaticamente por uma consulta que filtra `createdAt` — para cobertura de edições antigas é preciso adicionar processamento por eventos/`updatedAt` com suas próprias cotas. O versionamento de casos protege reanálises que cheguem ao motor.
4. A contagem de `duplicate_or_changed` pode representar duplicata legítima **ou** concorrência. O scanner permite avançar nesses resultados; um evento de edição simultânea poderá exigir reprocessamento por atualização no futuro.
5. Se houver várias instâncias executando a mesma janela, o CAS do checkpoint protege a posição de retomada contra gravações concorrentes, e os casos são idempotentes; isso não substitui um mecanismo de lease de processamento. Não ativar cron com paralelismo sem validação.
6. Os papéis administrativos e retenções seguem sujeitos à aprovação explícita. As flags de produção estão desligadas, e o código de leitura Firebase com chave JSON **não deve ser configurado por conveniência**.

Esta etapa melhora a **cobertura por volume**, preservando as garantias de QA e o objetivo de custo zero em novos serviços. Não transforma o Guardião em uma moderação autônoma permanente em produção.
