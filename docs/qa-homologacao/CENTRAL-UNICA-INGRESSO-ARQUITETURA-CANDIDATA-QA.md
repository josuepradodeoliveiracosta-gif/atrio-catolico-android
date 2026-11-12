# Central Única — arquitetura candidata para ingresso excepcional (QA)

**Situação: PROPOSTA, sem implantação/ativação, 12/11/2026.**
Esta análise não constitui decisão jurídica nem aprovação de privacidade.
Barra da Central segue **33% (2/6)**; o marco 3 continua aberto.

## Escolha técnica candidata (sujeita a autorização)

Recomenda-se **avaliar um gateway independente**, não reutilizar
a rota desativada `POST /event` do bootstrap
`cloudflare/qa-general-worker`, o Worker de push ou suas
tabelas de notificações. Uma opção futura é Worker
específico com armazenamento durável **separado**,
por exemplo um D1 exclusivo, jamais a coleção
`user_reports` aberta a gravações públicas anônimas.
A alternativa para uma conta ainda acessível é reaproveitar
a denúncia autenticada já existente. Para conta suspensa
ou sem login, estudar uma entrada externa protegida com
desafio e verificação de retorno, sem exigir CPF, foto
de documento ou dados religiosos. Não presumir que
App Check ou um desafio visual comprovem identidade
ou impeçam sozinhos abuso.

## Fronteiras e controles exigidos

1. Origem/projeto QA identificados no servidor e
   permissões isoladas. Nunca atingir produção por fallback.
2. Métodos, rotas, tamanho e formato aceitos estritamente;
   sem anexos inicialmente; mensagens e históricos não
   entram no pedido automático.
3. Verificação adequada da conta ou canal de recuperação;
   antispam real e limitação de taxa, sem rastrear ou
   discriminar pessoas desnecessariamente.
4. Não revelar se grupo, conta privada ou mensagem
   existe por conteúdo, resposta, tempo ou erro.
5. Somente o **servidor autorizado** confirma um protocolo
   após escrita durável com chave opaca única. Timeout
   exige leitura segura; reenvio igual não duplica;
   chave igual com conteúdo divergente é conflito.
6. Separar dados mínimos de contato e metadados
   do relato, acesso de moderador designado, motivo
   de acesso e revogação. Moderador não ganha leitura
   irrestrita de DMs e grupos.
7. Prazos de retenção, incidentes, urgências,
   recursos e direitos do titular precisam de
   procedimentos humanos aprovados; nenhum atendimento
   24h fictício.
8. Revalidar custo, quotas e dispositivos reais antes
   de escolher e autorizar infraestrutura.

## Evidência de laboratório, não serviço

`scripts/chat-qa-exceptional-gateway-model.mjs`
simula **envelopes categóricos**, sem dados pessoais
ou rede, e uma máquina de estados para timeout, replay,
conflito e recuperação. Os testes unitários comprovam
apenas que a simulação **não cria endpoint, gravação,
recurso privado ou recibo real**, mesmo após um
`COMMITTED` fictício.

**Não existe** novo Worker, banco, migração,
secret, formulário de envio nem cliente ativo.
É preciso autorizar a escolha técnica, testar
um servidor isolado com controles reais, validar
acesso/retencão, teste em dispositivo e revisão
humana antes do marco 3 poder ser concluído.
