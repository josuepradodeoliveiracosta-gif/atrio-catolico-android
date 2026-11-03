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


## Acompanhamento de estados administrativos sem falso comprovante — 02/11/2026

Quando o pedido autenticado foi lido **do servidor** (sem cache ou
escrita local pendente), o Android e o portal web agora distinguem:
`requested` (recebido), `processing` (em processamento),
`completed` (conclusão **informada** pelo atendimento, não comprovação
independente de eliminação) e `rejected` (pendência a esclarecer).
Origem inválida, data ausente, registro malformado ou estado desconhecido
continuam **indeterminados**. A solicitação existente nunca é
sobrescrita ou reaberta pelo cliente; alteração e exclusão de documentos
continuam reservadas ao backend autorizado.

Este ajuste melhora a informação prestada ao titular, **não** implementa
um executor de exclusão nem confirma que qualquer pedido foi
processado em ambiente real. Sem homologação do executor e das
exceções legais, a liberação Play permanece bloqueada.


## Atualização manual do andamento no Android (02/11/2026)

Na seção **Perfil → Exclusão de conta e dados**, o botão
**Atualizar andamento** aparece após um pedido autenticado válido, tanto
no estado `requested` quanto em `processing`, `completed` ou
`rejected`. A atualização depende de clique do titular, da sessão
Firebase correspondente ao UID e de leitura `Source.SERVER` sem
cache ou gravações pendentes. O botão usa a mesma leitura já existente
e não cria novo pedido, não escreve `status`, não inicia exclusão nem
libera quaisquer controles de publicação. Para erro ou registro
indeterminado permanece **Tentar novamente**.

Teste instrumentado da função de decisão do botão incluído na
suíte existente do aplicativo. A possibilidade de atualizar não
comprova que atendimento administrativo ou exclusão efetiva estejam
operacionais; a homologação continua pendente e todos os gates de
lançamento permanecem intactos.

## Painel administrativo de pedidos — 03/11/2026 (somente branch, sem deploy)

A PR #71 adicionou um painel **de consulta manual e somente leitura** na
tela de moderação, visível exclusivamente ao fundador com papel administrativo
confirmado pelo servidor. A consulta é limitada a 20 pedidos por página,
ordenada pela data, sem busca periódica nem acesso a senhas, e-mails ou
tokens. Exibe o UID técnico somente no painel administrativo, para permitir
identificar o pedido no processo supervisionado. O estado `completed`
significa apenas **conclusão declarada**; o painel não promete eliminação.
Os controles só apresentam a fila e permitem atualizar/carregar páginas.

A regra `account_deletion_requests` mantém `get` exclusivo ao titular,
mas permite **list** estritamente ao fundador habilitado em
`admins/{uid}`, apontado por `app_config/founder`, sem marcador de
congelamento e com limite de consulta até 20. Moderadores comuns,
terceiros e sessões anônimas não podem enumerar pedidos; ninguém via
cliente pode editar, excluir ou processar solicitações.
A suíte Firebase Emulator existente verifica esses casos e revogação
de acesso, sem compilar outro aplicativo por iniciativa deste documento.

**Não é um executor de exclusão**. O operador ainda deve confirmar
titularidade por canal seguro, revisar retenção e executar um procedimento
real homologado. O código de produção, regras publicadas, conta Firebase
real, Cloudflare, Play Console, backups e evidências continuam intactos.

Referência: https://support.google.com/googleplay/android-developer/answer/13327111?hl=pt-BR


## Montagem única e offline de exclusão, privacidade e termos (03/11/2026)

O novo `cloudflare/account-deletion-support/site-bundle.mjs` reúne,
**somente após receber três conteúdos aprovados**, as páginas estáticas
do canal externo de exclusão, da política de privacidade e dos termos
da comunidade em um único diretório para revisão:
`index.html`, `privacidade/index.html`,
`termos/{version}/index.html` e `_headers`.

Exige `ATRIO_DELETION_SITE_ORIGIN` HTTPS real (sem path, token,
consulta ou domínio de QA), e correspondência exata entre o endereço
da política usado no suporte, o endereço dos Termos, a origem do
site, o e-mail público e `ATRIO_PLAY_COMMUNITY_TERMS_VERSION`.
Reutiliza os validadores de conteúdo legal existentes. Escreve em
pasta temporária e depois move o pacote completo para o destino,
recusando sobrescrita de versão anterior e saída em diretórios
de código. Não coleta dados, não consulta Firebase/Cloudflare, não
cria canal automático de atendimento e **não publica nada**.

Para revisão privada via Termux, fornecer os caminhos locais de
`ATRIO_PRIVACY_POLICY_INPUT`, `ATRIO_COMMUNITY_TERMS_INPUT`,
as variáveis públicas documentadas do canal de suporte, a origem
HTTPS verdadeira e a versão de termos `community-v1` quando
confirmada na configuração do lançamento. Executar:
`node cloudflare/account-deletion-support/site-bundle.mjs`.
Sem todos os dados aprovados, **não existe pacote publicável**.
A compilação usa somente materiais fictícios nos testes. O workflow
Play executa `site-bundle.test.mjs` e verifica que nenhum pacote
foi gerado no repositório.

Importante: esse pacote só reduz erros de URLs e conteúdo
desalinhados. Uma declaração de aprovação não prova revisão jurídica,
operador disponível ou capacidade de excluir dados em Firebase,
Firestore e Cloudinary. É obrigatório comprovar atendimento real,
site HTTPS ativo e exclusão homologada antes de marcar evidências
ou assinar/enviar AAB. `releaseAuthorized` continua falso.
