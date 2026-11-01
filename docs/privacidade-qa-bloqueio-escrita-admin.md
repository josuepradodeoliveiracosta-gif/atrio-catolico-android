# Privacidade — bloqueio persistente de escrita administrativa (QA)

31/10/2026. Continuidade da PR #97. **Somente emuladores locais.**

## A lacuna que esta etapa aborda

As Firestore Security Rules atuais já incluem
`accountWritable(uid)`: documentos sob
`account_deletion_freeze/{uid}` impedem alterações diretas do
cliente por um usuário congelado. **O Admin SDK ignora essas Rules**
por possuir acesso privilegiado; um Worker ou serviço não
integrado poderia escrever após o congelamento.

A PR acrescenta `tests/security/admin-fixture/qa-admin-firestore-freeze.mjs`:
uma referência **exclusivamente de QA** de como escritores administrativos
podem obedecer a um mesmo marcador persistente.

## Protocolo testado no Firestore Emulator

- Usa exclusivamente projeto `demo-atrio-v11` e hosts
  `127.0.0.1:8089` (Firestore) e `127.0.0.1:9099` (Auth).
- Uma transação Admin SDK exige pedido `requested` no documento
  `account_deletion_requests/qa-delete-alice` antes de criar
  `account_deletion_freeze/qa-delete-alice`.
- O marcador possui `uid`, `status: processing`,
  `scope: qa-only` e `generation: 1`; criação idempotente.
  O teste bloqueia marcador ausente ou adulterado.
- Cada escritor administrativo **que usar o adaptador de QA**
  lê o marcador e escreve na mesma transação Firestore, negando
  novas escritas de Alice quando ele existe. O outro usuário
  (`qa-delete-bob`) pode continuar escrevendo.
- A fase `freeze_writes` do executor QA cria/valida o marcador
  antes de deletar dados. A retomada do checkpoint exige que o
  marcador continue válido; o processo também o relê antes do Auth.
- Depois de uma falha e de reconstruir as instâncias Admin SDK,
  o marcador continua válido e o escritor integrado não pode
  adicionar novamente registros.
- **Nenhum método público de remover o marcador é fornecido.**
  Ele permanece após o encerramento de QA. Retenção e remoção
  posterior só seriam possíveis mediante política administrativa
  explicitamente homologada.

A CI valida via Firebase Emulators, Cloudinary HTTP falso e SQLite.
Os testes distinguem negação por Security Rules do cliente e
negação por escritor Admin SDK integrado.

## Limitações essenciais

1. **Isto não configura ou protege os Workers reais.** O Admin SDK
   e os serviços externos que não usam esta barreira continuam
   capazes de bypass. A transação protege somente a escrita
   cujo código chama expressamente o adaptador. Um inventário
   completo e revisão de **todas** as rotas de escrita são necessários.
2. O marcador e sua geração são fixtures fixas. Não representam
   um protocolo distribuído de fencing, IAM, assinatura de revisores
   ou gestão de retenção legal.
3. Congelar um usuário após ele iniciar uma transação exige
   validação específica de concorrência e retentativas nos
   produtores reais. Operações fora do Firestore não participam
   desta transação (Cloudinary, FCM, HTTP, tarefas agendadas).
4. O portal HTTPS para solicitação e a exclusão de dados reais
   permanecem desativados, e a issue #72 continua aberta.
5. **Sem alteração de production, main, backups, assinatura,
   OTA, APK/AAB, Play Console ou configuração de Workers.**

**Estado:** QA apenas. `productionFreezeIntegrated=false`,
`allWritersCovered=false`, `productionReady=false`.

Próximo passo: inventariar e instrumentar TODOS os escritores com
controle do backend, inclusive Workers e jobs, sob princípio
de menor privilégio, antes de cogitar habilitação real.
