# Átrio Católico — inventário verificável de rotas privilegiadas (QA)

**Não é homologação de produção nem autorização de Play.** Contrato estático
em `cloudflare/account-deletion-audit/src/qa-worker-coverage-contract.js`.
A suíte da CI AAB já existente executa `npm --prefix
cloudflare/account-deletion-audit test`, incluindo o novo contrato.

- Quatro arquivos-fonte críticos possuem SHA de **Git blob** e marcadores
  de rotas, helpers e efeitos externos. Se um deles mudar, a CI exige
  revisão de segurança explícita e atualização consciente do hash.
- Há **15 entradas mutantes** mapeadas para categorias e escopos de contas,
  cobrindo Avatar, Guardião e Push. Cada entrada permanece marcada
  `not_integrated`, porque nenhum protocolo durável de produção foi conectado.
- Dez lacunas adicionais incluem writes de D1, rollback Cloudinary,
  FCM com resposta ambígua, cron, fila, broadcast e versões implantadas
  anteriores que não compartilham fencing.
- O contrato também bloqueia regressão para envio de respostas em tópico FCM
  e para desativação por variável do filtro bilateral.
- Não realiza rede, não cria serviços, não edita banco, não apaga contas e
  não executa deploy. Os SHA-1 indicam **integridade Git do código-fonte**,
  não autenticação do runtime implantado.

**Critério de saída:** cada caminho de escrita ativo deve ingressar em
coordenação persistente compartilhada com todas as contas afetadas, drenar
operações em trânsito e resistir a timeout, retry e erros ambíguos.
Só então poderão ser validados `worker_freeze` e `deletion_executor`
por evidências externas verificáveis. `releaseAuthorized:false`.
