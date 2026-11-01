# Átrio Católico — validação da proteção das rotas de Avatar (apenas QA)

**31/10/2026 — NÃO IMPLANTAR.** Etapa de desenvolvimento subsequente à PR #89; depende das propostas anteriores de privacidade e mantém a issue #72 aberta. A exclusão de contas ainda não é funcional.

## Escopo entregue

`cloudflare/account-deletion-audit/src/qa-avatar-route-gate.js` representa uma **camada somente de testes** que envolve a função **real** `avatar-worker/src/index.js -> fetch`, sem editar esse Worker. A camada exige uma identidade simulada de confiança injetada por QA, admite uma operação no registro SQLite de QA antes de chamar o Worker e mantém a operação em aberto se o resultado for desconhecido ou não for confirmado.

Rotas reconhecidas e respectivas categorias:

| Rota real | Categoria no registro QA |
|---|---|
| `POST /avatar/upload` | `avatar_upload` do titular |
| `POST /avatar/status` | `avatar_promote` do titular — **pode publicar a foto** |
| `DELETE /avatar` | `avatar_remove` do titular |
| `POST /avatar/moderate` | `avatar_moderation` envolvendo moderador e titular |
| `POST /avatar/moderation/review` | `avatar_moderation` envolvendo moderador e titular |
| `GET /avatar/moderation/pending` | leitura (sem ticket de alteração) |
| `GET /avatar/moderation/preview` | leitura (sem ticket de alteração) |

Qualquer rota/método desconhecido é rejeitado **na camada de QA**. O UID do alvo de moderação vem de uma cópia do corpo limitada a 384 bytes (e nunca de uma indicação livre do cliente no registro da barreira). Para as operações que envolvem dois usuários, o registro SQL é indivisível; se o alvo ou o moderador estiver congelado, a operação não começa.

O módulo `qa-avatar-route-gate.test.js` exercita o Worker real com **Firebase Identity Toolkit, Cloudinary e D1 simulados**. Verifica, entre outros casos: nenhuma consulta ou escrita após o congelamento; upload protegido e registro pendente no schema SQLite real de Avatar; promoção tratada como escrita; ausência de liberação quando a Cloudinary falha; verificação externa falsa impedindo conclusão; operação em andamento que deve terminar antes do freeze; e requisições inválidas de moderação sem efeitos.

## Limite crítico

**Isto NÃO é integração com produção.** O Worker de Avatar original **não importa** o gateway e **não é obrigado a passar por ele**. O componente reside no módulo de auditoria QA, utiliza duas identidades artificiais (`qa-freeze-alice`, `qa-freeze-bob`) e uma função de autenticação injetada por testes; portanto, não é compatível com identidade real, IAM, contas verdadeiras ou implantação.

A confirmação `verifyEffect` também é uma função de teste. Para um backend real seria necessário verificar o efeito no Cloudinary, Firestore e D1 antes de retirar cada ticket, com controles de reentrada e reconciliação de falhas. O atual bloqueio não substitui o controle contra requisições antigas e não oferece atomicidade entre serviços.

As outras duas famílias de Worker (Guardião/Push), suas rotas administrativas, cron jobs e retries continuam aguardando integração real e cobertura mais extensa. Não é permitido publicar, implantar ou mesclar como solução de exclusão de conta finalizada.

## Proteções operacionais preservadas

Os testes são executados pelo GitHub Actions através de `node --experimental-sqlite --test cloudflare/account-deletion-audit/src/*.test.js`, sem conectar a infraestrutura externa. Nenhuma conta real é alterada, nenhum APK/AAB é gerado para distribuição, e a OTA, a chave de assinatura permanente e os backups não são modificados.

**Próxima tarefa:** repetir o mesmo princípio de cobertura total das rotas mutáveis nas famílias Guardião e Push, mantendo tudo em QA até que haja uma arquitetura de autorização e verificação homologada.
