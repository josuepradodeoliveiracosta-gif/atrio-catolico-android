# Prova HMAC privada — somente leitura, 4 de novembro de 2026

PR #71, `demo-atrio-v11`. O estágio de exclusão continua **somente fictício**, sem IAM para dados reais.

## Mecanismo

Uma nova rota interna `POST /v1/role/status` aceita SOMENTE o papel HMAC e UID fixos: `avatar → qa-freeze-alice`, `guardian → qa-freeze-bob`, `push → qa-freeze-alice`. Executa apenas `barrier.status(uid)`, devolvendo `uid, state, inFlight` com `syntheticOnly:true`, `productionReady:false`, `providerEffectsVerified:false`. Nunca cria tickets de escrita, não muda estado congelado, não autoriza Auth e não utiliza APIs externas. Como todos os endpoints HMAC, registra exclusivamente nonce anti-replay na D1 sintética.

Cada cliente privado de homologação pode executar uma única sondagem no evento scheduled da data 2026-11-04, utilizando um UUID4 predefinido e exclusivo por papel. A chave HMAC é lida do binding secreto do próprio cliente, sem exposição ao operador. A recusa de replay impede mais de um registro por papel, independentemente de novas entregas cron. Fora da data e cron `* * * * *`, a função não opera.

A confirmação operacional exige os 3 nonces D1 novos, estado `qa-freeze-alice=frozen`, `qa-freeze-bob=active`, operações in-flight igual a 0, nenhuma alteração na contagem histórica dos canários e nos casos QA. Isto comprova que cada cliente chegou ao Worker hospedado autenticado. **Não** comprova IAM de produção ou ausência de writes externos.

## Política de implantação

A atualização do código na PR e a promoção para os quatro Workers **privados** precisam manter subdomínio, previews, domínios customizados e rotas desativados, conservar os bindings e permitir rollback. Os cron triggers são temporários e devem ser apagados assim que D1 provar o recebimento ou houver falha. Nunca configurar cron em Workers oficiais. Proibido alterar contas reais, Firebase, FCM, Cloudinary, main, backups ou Play Console.
