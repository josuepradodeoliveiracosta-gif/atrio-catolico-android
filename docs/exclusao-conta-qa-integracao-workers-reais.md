# Homologação das funções reais dos Workers — barreira privilegiada (QA)

**31/10/2026 | PR de desenvolvimento, sem publicação, deploy, credenciais nem dados reais.**

Este trabalho parte da PR #85 e da cadeia #73 → #74 → #77 → #78 → #79 → #80 → #81 → #82 → #83 → #84 → #85. A issue #72 continua aberta e bloqueia a liberação da Play Store.

## O que foi efetivamente testado

O arquivo `cloudflare/account-deletion-audit/src/qa-worker-write-boundary.integration.test.js` importa **funções reais já existentes** de cada Worker, mas substitui suas chamadas de rede por HTTP fictício e executa as operações por dentro da barreira SQLite simulada:

| Serviço | Função existente utilizada | Recurso falso observado |
|---|---|---|
| Avatar | `cloudSigned` | POST de upload autenticado Cloudinary |
| Guardião V2 | `processDocument` | Commit simulado de caso, auditoria e aviso |
| Push/Firestore | `writeThreadNotices` | POST de batchWrite das notificações |
| Push/FCM | `cleanupInvalidDevice` | DELETE simulado de token inválido com precondição |

O teste confere que, quando as chamadas são **executadas através da barreira**, o congelamento impede novos efeitos. Também verifica que falha de rede com resultado desconhecido mantém o ingresso aberto e impede declarar a conta congelada, e que o usuário não afetado continua operando.

Foram reforçadas as condições de encerramento de tickets de múltiplos participantes na `qa-privileged-write-barrier.js`: um DELETE SQL condicional confirma o conjunto total de participantes na mesma instrução, evitando concluir apenas uma metade de uma notificação que envolva duas contas. Há testes específicos de tickets adulterados e tentativas de conclusão parcial.

## Lacuna comprovada de segurança

**Os Workers ativos AINDA NÃO estão conectados à barreira.** Um teste negativo mostra que uma chamada direta a uma função exportada, sem a barreira, continua disparando uma requisição *mock* mesmo após o congelamento da conta na tabela de QA. Essa evidência é deliberada: não queremos confundir um protótipo aprovado com proteção efetiva de produção.

A varredura dos fontes identifica ainda rotas internas que precisam de proteção na futura integração:

- Avatar: `upload`, `status` (pode promover imagem), `remove`, `moderateRemove`, revisão de moderação e todos os caminhos que gravam D1 ou Cloudinary.
- Guardião: `processDocument`, revisões `reviewCase`, resolução de casos, cron/scans e commits.
- Push: `writeThreadNotices`, envio FCM `send`, invalidação de dispositivos, relatórios, revisão/retorno e notificações administrativas.

O inventário ainda precisa cobrir as rotas auxiliares, cron e retry. Modificações futuras nesses Workers devem disparar nova revisão do catálogo de operações privilegiadas.

## Próxima integração segura

1. Criar **bindings isolados de QA**, com a barreira ligada em cada ponto de escrita, e testar *todas* as rotas sem exceção; nunca reutilizar chaves, banco D1 ou dados reais para homologação.
2. Aprovar tecnicamente o protocolo de tratamento de efeitos externos em trânsito e de perda de conexão; o ticket de uma operação sem confirmação não deve ser descartado.
3. Projetar o bloqueio para serviços antigos e cron, além das regras do Firestore, com IAM mínimo, bloqueio de novas escritas e repetição do inventário global.
4. Implementar o executor administrativo completo e seguro, com decisões de retenção, verificação pós-exclusão de Firebase/Cloudinary/D1/FCM e página pública HTTPS.
5. Só então avaliar merge e liberação Play. **Nenhuma conta real está apta a exclusão nesta fase.**

## Custo e comandos de QA

Os testes de privacidade existentes incluem `src/*.test.js`, executados com SQLite local e HTTP interceptado. Eles não usam serviços externos, não geram APK/AAB, não implantam Worker e não alteram o repositório de backup.

`node --experimental-sqlite --test cloudflare/account-deletion-audit/src/qa-worker-write-boundary.integration.test.js`

O código de QA deve permanecer fora das entradas de produção. Qualquer resultado positivo de teste demonstra somente o *comportamento simulado sob o wrapper*, não integração ativa ao aplicativo.
