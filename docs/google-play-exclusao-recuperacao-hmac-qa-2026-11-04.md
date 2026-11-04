# Recuperação segura de sonda HMAC — QA privado

Data: 04/11/2026. PR #71 draft. Somente projeto demo-atrio-v11, duas contas fictícias e D1 segregado.

## Falhas cobertas em CI

A confirmação de um pedido HMAC possui **dois pontos distintos**: o nonce de anti-replay pode ser gravado sem que o recibo de status seja gerado, e o recibo pode ser gravado sem que o consumidor receba a resposta por falha de conexão.

Novos testes verificam:

1. A perda da resposta **após** o commit do recibo não autoriza um segundo pedido com nonce idêntico. O estado pode ser verificado por uma leitura independente da tabela de recibos; nenhum ticket é criado.
2. Um recibo do Avatar **não** certifica o Guardião ou o Push se o estado da conta fictícia vizinha se alterar antes das respectivas consultas.
3. Duas execuções concorrentes do evento agendado para o mesmo papel produzem no máximo **um** recibo, por nonce e restrições D1.

## Resultado hospedado e condição de encerramento

A sondagem hospedada só poderá ser considerada comprovada após a verificação das **três linhas** em `qa_stage_hmac_role_proofs`, cada uma no papel, UID, nonce e estado exatos, mantendo zero operações pendentes. A consulta D1 deve ser acompanhada de verificação de versões, bindings e ausência de exposição pública.

Não confundir testes de integração SQLite/HMAC locais com execução real dos Workers hospedados. Os agendamentos temporários precisam ser removidos e conferidos. Nenhuma prova de exclusão real, Firebase Auth, Cloudinary ou FCM é obtida por este ensaio.
