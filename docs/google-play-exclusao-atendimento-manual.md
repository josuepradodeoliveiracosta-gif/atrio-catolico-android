# Átrio Católico — opção simplificada de exclusão de conta pela Web

**02/11/2026 · PR #71 (rascunho) · Não publicada nem pronta para uso real.**

## Fundamentação
A [política da Google Play](https://support.google.com/googleplay/android-developer/answer/13327111?hl=pt-BR) aceita um recurso da Web com e-mail de atendimento para iniciar a solicitação de exclusão de conta. Um formulário autenticado e a exclusão automática diretamente no navegador não são obrigatórios. **Contudo, receber um pedido ou congelar a conta não substitui excluir a conta e os dados associados**, respeitadas as retenções legais divulgadas.

Uma nova alternativa está em **cloudflare/account-deletion-support/build.mjs**. O gerador cria uma página estática com endereço de e-mail de suporte e link à política de privacidade. Não exige instalação do aplicativo, não pede senha, não coleta dados no site, não acessa Firebase/Cloudinary, não faz deploy nem executa exclusão. A opção Firebase previamente desenvolvida permanece intacta e bloqueada.

## Condições antes de habilitar e publicar
1. **Responsável** define um e-mail público de suporte/privacidade, verifica recebimento, atendimento e instruções seguras para comprovar a titularidade. Não exigir senha, token ou documentos pessoais no e-mail inicial.
2. **Revisão jurídica/LGPD** aprova política de privacidade, tratamento de dados religiosos, prazos, bases jurídicas e exceções de retenção.
3. **Engenharia** garante o tratamento efetivo de Auth, Firestore, perfis, conteúdo, imagens, Cloudinary, notificações e demais serviços, com auditoria, permissões restritas, reconciliação e proteção de dados de terceiros. Pode ser um procedimento administrativo supervisionado, desde que realmente funcione.
4. **Operação** publica a página em HTTPS com o nome Átrio Católico, testa em navegador anônimo, confirma o recebimento do e-mail e registra evidência verificável de uma solicitação de teste e seu processamento.
5. **Play Console** recebe a URL pública de exclusão na seção Segurança dos dados. Validar também o caminho de solicitação dentro do aplicativo.

## Contato público informado pelo responsável — 02/11/2026

Endereço criado e informado pelo proprietário para uso como canal público
de privacidade e solicitações de exclusão:

**atriocatolico.privacidade@gmail.com**

O endereço pode ser utilizado no projeto, sem armazenar senhas ou tokens.
O responsável **confirmou neste atendimento, em 02/11/2026, que o
Gmail foi criado e testado com sucesso**, após as orientações de
enviar e responder uma mensagem por outra conta. Essa é uma
**declaração de teste manual do titular**; não houve inspeção
independente das mensagens, das datas, do atendimento contínuo
nem de uma solicitação real de exclusão.

**Ainda não estão homologados:** monitoramento rotineiro da caixa,
processamento seguro de pedidos, revisão jurídica ou página HTTPS
pública. Manter `ATRIO_PLAY_SUPPORT_REVIEWED` e
`ATRIO_PLAY_SUPPORT_MAILBOX_MONITORED` sem aprovação até a
validação operacional pertinente.

O workflow manual usa esse endereço público como fallback de
`ATRIO_PLAY_SUPPORT_EMAIL`. O modo de exclusão segue por padrão
`firebase`, e nenhum formulário ou lançamento é liberado apenas
pela presença desse e-mail. A pessoa responsável poderá mudar o
contato depois via GitHub Actions Variables.

## Construção local (nenhum deploy)
O operador precisa fornecer estes valores públicos e uma declaração de revisão, fora do repositório:
- ATRIO_DELETION_SUPPORT_APPROVED = manual-support-and-privacy-reviewed
- ATRIO_DELETION_SUPPORT_EMAIL = endereço público real, aprovado
- ATRIO_DELETION_PRIVACY_URL = URL HTTPS real da política

Então executar o comando de build do arquivo **cloudflare/account-deletion-support/build.mjs** pelo Node 22. A saída local é a pasta **cloudflare/account-deletion-support/dist**, contendo index.html e _headers. Não há publicação automática. Sem os dados exigidos, a geração é bloqueada.

No GitHub Actions, o modo padrão **firebase** e todos seus bloqueios são preservados. A opção alternativa exige configuração explícita:
- ATRIO_PLAY_DELETION_MODE = manual-support
- ATRIO_PLAY_DELETION_PORTAL_URL = URL HTTPS real da página publicada
- ATRIO_PLAY_SUPPORT_EMAIL = e-mail público aprovado
- ATRIO_PLAY_SUPPORT_REVIEWED = manual-support-and-privacy-reviewed
- ATRIO_PLAY_SUPPORT_MAILBOX_MONITORED = true
- ATRIO_PLAY_PRIVACY_POLICY_URL = endereço HTTPS da política

O gate de pré-assinatura verifica a coerência estática desses itens e a presença dos testes de construção. **Variáveis NÃO constituem prova de caixa monitorada, revisão jurídica, implantação do site ou exclusão real.** Evidências externas independentes são obrigatórias antes de qualquer assinatura.

## Bloqueios preservados
Os manifestos de evidências permanecem com **0/9 de privacidade** e **0/6 de UGC** homologados, todos os campos relevantes ainda em falso. O fluxo administrativo no Firebase Emulator com contas fictícias permanece obrigatório. Não foi feita assinatura, upload no Play Console, implantação ou alteração da main/backups/produção. Uma página publicada isoladamente NÃO autoriza iniciar a faixa fechada.

**Decisão de produto:** reduzir a complexidade do ponto de entrada Web, mas não reduzir as obrigações reais de eliminação dos dados, segurança e resposta ao usuário.

## Integração de acompanhamento no aplicativo (02/11/2026)

A seção Android **Perfil > Exclusão de conta e dados** agora exibe o
e-mail público selecionável e o botão **Contatar atendimento por
e-mail**, com assunto fixo e sem UID, senha, token ou outros dados
privados na URL. Não envia mensagens automaticamente; abre o
aplicativo de e-mail selecionado pelo usuário. Se não existir um
cliente de e-mail, a UI orienta a copiar o endereço e enviar
manualmente. O pedido autenticado no Firestore permanece idêntico.

O teste Android instrumentado, somente com usuário fictício no
Firebase Emulator, confirma que o botão de contato e o endereço
continuam visíveis **após o registro de solicitação**. Isso
não comprova entrega real de e-mail nem o processamento de exclusão.


## Ligação direta da URL externa no Android (02/11/2026)

O pacote Android mantém a seção autenticada de solicitação no perfil e
agora aceita a URL HTTPS pública da Play no campo público
**BuildConfig.DELETION_WEB_URL**. O build lê exclusivamente
**ATRIO_DELETION_PORTAL_URL**, já fornecida pelo workflow de assinatura
manual a partir da variável GitHub Actions
**ATRIO_PLAY_DELETION_PORTAL_URL**.

A URL vazia é normal em QA. Somente quando for configurada uma URL
HTTPS real, sem credenciais, query string, fragmento ou porta insegura,
aparecerá o botão **"Solicitar exclusão pelo site"** na tela
**Perfil > Exclusão de conta e dados**. O botão abre o navegador sem
enviar UID, conta, token ou texto privado; se falhar, orienta o usuário
a recorrer ao e-mail público. Na variante Play sem URL o aplicativo
mostra explicitamente que a página de exclusão está pendente.

O gate estático de pré-assinatura confirma a presença e os estados
seguros dessa integração, além dos gates já existentes que exigem
comprovação da URL. O gate ao vivo lê o site HTTPS publicado. Nenhum
destes testes substitui comprovar recebimento, processamento ou
remoção de dados reais.

**Hospedagem — atualização de 02/11/2026**: foi criado
na conta Cloudflare conectada o projeto de homologação
`atrio-catolico-privacidade-qa`, separado dos serviços existentes.
API confirmou `latest_deployment: null`, sem integração Git ou
implantação de site. O endereço `atrio-catolico-privacidade-qa.pages.dev`
está reservado para **QA e é recusado pelos gates da Play como URL
de produção**. Permanecem pendentes a revisão da política,
publicação efetiva de páginas HTTPS e o procedimento real de exclusão.
Ver `docs/google-play-hospedagem-pages-qa.md`.
