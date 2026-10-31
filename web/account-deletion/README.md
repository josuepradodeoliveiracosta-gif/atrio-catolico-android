# Portal de solicitação de exclusão — Átrio Católico

**Projeto estático proposto, NÃO publicado.** Não é um serviço de exclusão completo e não deve ser anunciado como funcional antes do backend processador estar homologado.

## Comportamento preparado

- Página HTTPS que funciona em um navegador, sem instalar o Android.
- Login por **e-mail e senha do Firebase Authentication existente** (a mesma forma de acesso do aplicativo).
- Sessão Firebase somente em memória do navegador, sem persistência em localStorage.
- Registro Firestore `account_deletion_requests/{uid}` com origem `web`, horário do servidor e status `requested`.
- Pedido duplicado recusado pelas mesmas regras do aplicativo; usuários não podem ler pedidos alheios, editar ou marcar como processados.
- Recuperação de senha via Firebase, sem informar se o e-mail realmente existe.
- Falha fechada: sem `config.js` real e `ATRIO_ACCOUNT_DELETION_REQUESTS_ENABLED=true`, os botões permanecem desativados.

## Publicação segura futura

1. Revisar e integrar a PR #73, que introduz o registro do pedido no aplicativo; integrar depois a PR desta página, com regras de origem `web` e testes.
2. Concluir o **executor real** de exclusão (Auth + coleções/subcoleções Firestore + fotos Cloudinary + notificações/FCM + retenções justificadas) e atendimento administrativo. Auditoria somente-leitura NÃO basta.
3. Hospedar esta pasta em **Cloudflare Pages** ou outro HTTPS verificado pelo proprietário, sem associar contas a um endereço fictício.
4. No projeto Firebase `atrio-catolico`, registrar o domínio autorizado para Firebase Authentication e verificar a política de chaves Web. Usar somente dados públicos do Firebase Web App.
5. Copiar `config.example.js` para `config.js` **somente no ambiente de hospedagem**. Esse arquivo não deve conter credenciais administrativas, JKS, Cloudinary secrets ou senha de usuário. Deixar a flag **false** até concluir os testes end-to-end.
6. Conferir página pela navegação anônima, acessibilidade, login válido/inválido, recuperação de senha, solicitações repetidas, falhas de conexão e confirmação administrativa.
7. Depois de disponível e funcional, indicar o endereço verificado no Google Play Console e na política de privacidade.

**Não implantar o portal como destino de solicitação antes do atendimento completo estar operacional.** O Google Play exige processo efetivo e política clara, não apenas aparência de conformidade.

## Custos e compatibilidade

A página é estática, sem base paga adicional e com uso do projeto Firebase já existente. O hosting pode ser feito na infraestrutura Cloudflare já adotada, sujeito às quotas dos serviços.

## Segurança

A chave de API Firebase Web é um identificador público; não confunda com segredo de conta de serviço. A API deve ser restrita conforme a configuração do projeto e o domínio deve ser autorizado no Firebase Authentication.
