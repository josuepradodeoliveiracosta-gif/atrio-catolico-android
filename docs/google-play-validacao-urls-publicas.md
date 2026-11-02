# Google Play — validação ao vivo dos endereços públicos (02/11/2026)

**Escopo: PR #71 / branch de QA. Nenhum serviço foi alterado.**

## Por que este gate existe

Uma URL HTTPS bem formada no repositório não prova que a página tenha
sido publicada ou que ofereça um caminho real de solicitação de
exclusão. O Google Play exige recurso Web acessível externamente, com
referência clara ao aplicativo, e caminho que permita **iniciar** um
pedido sem reinstalar o app. O caminho pode ser um endereço de
atendimento ao usuário. A exclusão posterior da conta e de seus dados
também permanece obrigatória.

Referências oficiais:
- https://support.google.com/googleplay/android-developer/answer/13327111?hl=pt-BR
- https://support.google.com/googleplay/android-developer/answer/10144311

## Implementação

O novo script padrão da biblioteca Python,
**scripts/play_web_live_preflight.py**, é executado
**somente no workflow manual de AAB assinado**, depois dos gates
estáticos e **antes de qualquer segredo da assinatura**.

Executa GET público HTTPS nos endereços já aprovados e configurados:
- Política de privacidade: exige documento HTML acessível identificando
  o Átrio Católico e a política.
- Exclusão de conta: exige documento HTML acessível identificando
  o Átrio Católico, exclusão e conta.
- Modo de e-mail: exige link mailto para o contato configurado e link
  para a política pública correspondente.
- Modo Firebase: exige formulário de login e lê os recursos públicos
  config.js e app.js para confirmar que **ambos os intertravamentos
  de operação estão efetivamente habilitados no site servido**, não
  apenas no código-fonte.

Medidas de segurança: apenas HTTPS em nomes DNS públicos, resolução
que bloqueia IPs não públicos, sem login/cookies/segredos, sem
redirecionamentos, timeout, teto de **256 KB por recurso**, codificação
UTF-8 estrita, status 200 e tipo de conteúdo válido. Nunca envia
pedido, não faz POST e não apaga nenhuma conta.

O CI **sem assinatura** roda somente os testes sintéticos e confirma
a posição do gate no workflow manual, sem acessar endereços públicos.
O modo de assinatura manual continua restrito à main, exige
aprovação do titular, certificado, evidências de privacidade/UGC e
Auth/Firestore Emulator. Esta etapa não modifica esses requisitos.

## Limitação importante

Este teste ao vivo **não comprova** que o endereço de e-mail receba
mensagens, que haja suporte humano efetivo, que a política jurídica
esteja correta ou que dados de uma conta sejam excluídos. Essas
evidências requerem verificação externa com revisores e data,
sem falsificar aprovações. Uma página pode funcionar hoje e falhar
amanhã; a operação deve manter monitoramento após a publicação.

Os manifestos permanecem **0/9** privacidade, **0/6** UGC e
releaseAuthorized=false. Nenhum AAB assinado ou upload foi executado.
