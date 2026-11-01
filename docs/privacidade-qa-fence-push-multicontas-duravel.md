# Privacidade — operação Push coletiva com fence persistente (QA)

Esta evolução da **PR #98** altera apenas o adaptador de homologação `qa-worker-drain.mjs` e os testes; não importa a barreira em um Worker implantado.

## Problema mitigado

Uma operação de Push pode afetar **autor e destinatário** simultaneamente. O registro SQLite anterior armazenava somente o UID principal. Consequentemente, uma notificação enviada por Bob para Alice poderia permanecer em execução sem impedir o congelamento de Alice.

## Protocolo testado

- `beginFanout(actorUid,recipientUids)` exige explicitamente todas as contas, limitadas aos dois UIDs fictícios e com destinatários sem repetição.
- Um único `INSERT ... SELECT` condicional só reserva a operação se **todos** os participantes estiverem ativos no mesmo instante. O registro durável conserva o conjunto canônico em JSON no SQLite; não existem permissões parciais.
- `status(uid)`, `seal(uid)` e `verify(uid)` observam qualquer operação que envolva o UID — mesmo que seja apenas destinatário.
- `completeFanout` só encerra o ticket com o **mesmo conjunto integral de contas**, após verificação externa simulada explícita. Resultado falso, timeout ou identificação incompleta mantêm a pendência e bloqueiam a exclusão.
- Conexões SQLite independentes, reabertura da conexão, conta congelada, destinatários adulterados e preservação da segunda conta são exercitados na CI.
- Não se aceita silenciosamente esquema antigo de ledger que não registra todos os participantes: ele deve ser revisto e reconciliado antes de qualquer migração.

**Limites:** o protocolo ainda não autentica os Workers, não suporta fanout arbitrário ou múltiplos servidores D1, e não é conectado ao Worker real. A integração com o executor administrativo demonstra o **mesmo UID dos emuladores Firebase**, mas não autoriza exclusões reais. Backups, `main`, assinatura Android, OTA, Cloudflare/Firebase de produção e issue #72 permanecem preservados.
