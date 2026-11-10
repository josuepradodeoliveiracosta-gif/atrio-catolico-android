# Átrio Conversas — registro de decisões de segurança para homologação

**Estado: MINUTA PENDENTE. Não é aprovação, política publicada, parecer
jurídico, autorização de deploy nem comprovação de idade.**

Escopo: Átrio Conversas, mensagens diretas e grupos, na PR draft #193.
Consolida os portões abertos da issue #200 e do roteiro de retenção existente,
sem decidir pelo fundador ou pela revisão de privacidade/jurídica.

## Decisão vigente do fundador: idade mínima para chat (10/11/2026)

**REQUISITO FUNCIONAL DEFINIDO:** somente usuários com **18 anos
completos ou mais** poderão participar de conversas individuais e
grupos de chat. **Menores de 18 anos não podem utilizar o chat.**
A decisão anterior de **16 anos** (09/11/2026) foi expressamente
**substituída** pela nova decisão do fundador em 10/11/2026.

**Escopo:** Átrio Conversas e grupos de chat. Não estabelece automaticamente
faixa etária para posts e demais recursos da comunidade.

**Ainda pendente:** avaliação de um método confiável de comprovação de
idade no servidor, minimização de dados, risco de acesso provável por
menores, prevenção de contatos indevidos, moderação, denúncias,
retenção, direitos do titular e revisão jurídica/privacidade. A
definição de 18+ não afasta automaticamente obrigações de proteção de
menores quando houver possibilidade real de acesso.

**Lacuna técnica:** `minorPolicyApproved` e `reviewExpiresAt` não
comprovam idade. O laboratório exige documento fictício
`minimumAge=18`, `policyVersion=2026-11-18plus-qa-v1`, expiração
futura e escrita de cliente negada. Provas anteriores de limiar 16
ficam inválidas sob a nova política. Ausência, expiração ou revogação
impedem acesso ao chat (fail-closed). Não coletar CPF, documentos ou
fotografias de identidade nas conversas.

**Status:** apenas o limite de idade foi aprovado pelo fundador; o
método de verificação, o procedimento operacional e qualquer implantação
ou ativação QA/produção continuam **NÃO AUTORIZADOS**. Issue #200 aberta.

### Fluxo de pré-triagem no cadastro — decisão de arquitetura em 10/11/2026

O fundador aprovou **iniciar a aferição de idade no cadastro** e
**condicionar o chat à verificação confiável no servidor**.
Implementação de protótipo QA (`br.com.atriocatolico.chatqa`):
- formulário de criação de conta oferece uma data de nascimento
  **opcional e exclusivamente local**, usada para indicar se a idade
  informada alcança o mínimo 18+;
- a data não é armazenada pelo Android após o descarte da tela, não é
  enviada nem escrita no Firebase; a pré-triagem não cria prova etária,
  não preenche `chatAgeEligibility/current` e não altera o cadastro
  de usuários antigos, login, release ou aplicativo oficial;
- idades informadas menores de 18, ausentes ou inválidas **não
  impedem cadastro para outras áreas permitidas**, mas **não liberam chat**;
- maiores declarados de 18 anos também ficam **sem chat** até que
  método externo confiável produza prova minimizada, autenticada,
  com validade, revogação e conferência no servidor;
- testes unitários cobrem limites de idade, datas inválidas,
  bissextos e formatação. Compilação Chat QA com JSON **sintético**
  valida a integração da UI sem acesso ao Firebase real.

**Ainda não implementado:** fornecedor, procedimento e registro de
prova confiável 18+ no servidor, comunicação de resultados após
cadastro/login, revisão jurídica/LGPD, controles contra fraude e
acesso indevido, moderação e retenção. **Não usar a data informada
como autenticação nem inserir prova sintética em nuvem.** Issue #200
permanece bloqueadora e QA geral continua 2/7 marcos (29%).

### Contrato de atestado criptográfico — apenas teste offline (10/11/2026)

Foi criado um contrato mínimo sintético `firebase/qa-general/age18-attestation-contract.mjs`
para a interface entre cadastro e **futuro** verificador confiável de
maioridade. Usa atestações Ed25519 fictícias, com emissor e chave
pública de confiança fornecidos pelo servidor de testes, UID vinculado
à sessão autenticada, desafio imprevisível, versão da política 18+,
`iat`, `exp` e identificador `jti` contra reuso. **Não** envia datas de
nascimento, CPF ou documentos; campos inesperados são recusados.

O contrato só valida dados sintéticos e retorna uma indicação interna.
**Não** salva `chatAgeEligibility/current`, não é produto, não comprova
idade real e não escolhe um fornecedor. A coleção `Set` usada nos
testes para detectar replay **não** atende servidores distribuídos:
será preciso persistência/consumo atômico, controle de desafios,
chaves confiáveis e auditoria minimizada. A eventual emissão de
elegibilidade deverá ser no backend, após aprovação humana específica
da Issue #200; o cliente jamais poderá outorgar a própria idade.

### Vínculo de sessão e desafio — teste offline, sem emissão de elegibilidade

O laboratório QA simula uma sessão de identidade **já autenticada pelo
servidor** por meio de um resolvedor fornecido pelos testes. O servidor
futuro deverá verificar tokens reais via Admin SDK e controlar
`uid`/identificador de sessão e desafios imprevisíveis associados
a eles. Troca de conta ou sessão, desafio reutilizado ou expirado,
atestado para menor de 18 anos e prova de política antiga devem
falhar fechados. Os testes offline demonstram somente o contrato
esperado, sem autenticação real ou Firestore real.

Não gerar permissão automaticamente após a pré-triagem no cadastro.
Sem aprovação da Issue #200, o backend de verificação e
a emissão da elegibilidade continuam inexistentes.

### Regressões de segurança do vínculo (10/11/2026)

O modelo offline de sessão tem testes adicionais para **logout antes da
comprovação**, novo login com o mesmo UID mas sessão diferente,
chave confiável substituída em variável externa, reutilização de
desafio previamente consumido, relógio regressivo e tempo fora de
faixa. São exemplos fictícios, não integração operacional do
Auth/Firestore. O backend real exigirá pinagem e rotação auditada
de chaves, verificação e revogação efetiva de sessão, armazenamento
atômico e persistente de desafios e `jti`, aprovação da Issue #200,
bem como revisão jurídica e de privacidade antes do QA remoto.

## Condições atuais verificadas

- A suíte Firestore Emulator testa bloqueio por `minorPolicyApproved`,
  `safetyReviewVersion`, `version` e `enabled` (valores de teste apenas).
- Elegibilidade para grupos exige decisão administrativa e
  `reviewExpiresAt` posterior à hora da requisição, mas **não comprova idade**.
- O Firebase QA real foi verificado por leitura somente leitura no Termux do
  operador: projeto/app Android ativos, Firestore QA **deny-all**.
- Worker Cloudflare `atrio-qa-geral` está em bootstrap fechado, sem FCM.
- Nenhum teste automatizado substitui revisão humana, jurídica ou de privacidade.

## Quadro de decisões ainda obrigatórias

| Tema | Decisão a registrar pelo responsável | Evidência mínima antes da ativação | Estado |
| --- | --- | --- | --- |
| Público e menores | **Idade mínima do chat: 18 anos (atualizada pelo fundador em 10/11/2026)**; definir alcance em grupos, aferição individual confiável, supervisão quando aplicável e revogação | Avaliação de risco e conformidade, fornecedor/método avaliado, testes de falsificação, expiração e indisponibilidade | **LIMITE DEFINIDO; IMPLEMENTAÇÃO E REVISÃO PENDENTES** |
| Solicitações e bloqueios | Consentimento e prevenção de contato não solicitado, assédio, spam e aliciamento; limites e sanções | Testes de bloqueio bilateral, abuso, troca de conta, limites e recursos | **PENDENTE** |
| Denúncias | Canal de entrada, equipe credenciada, acesso mínimo, prioridade, triagem, recurso e emergência | Roteiro de incidentes e testes de privacidade; nenhuma leitura geral de DMs por moderador | **PENDENTE** |
| Evidências e ex-integrantes | Preservação, proteção e apresentação de denúncias por ex-membros sem ampliar acesso privado | Testes de desligamento, remoção, não repúdio, abuso de protocolos e controle humano | **PENDENTE** |
| Retenção por coleção | Prazos e bases por classe: mensagens, grupos, convites, denúncias, preferências, auditoria, backups | Inventário aprovado, preservação legal, minimização, testes de expurgo sem perda indevida | **PENDENTE** |
| Direitos do titular | Procedimentos de acesso, correção, eliminação, contestação e identidade do solicitante | Procedimento operacional, trilha sanitizada, separação de papéis, custos | **PENDENTE** |
| Aprovação final | Revisão jurídica/privacidade, responsável, data, escopo e autorização de rollout **separada** | Ata/registro de decisão e testes end-to-end reais específicos do escopo autorizado | **PENDENTE** |

## Fases e efeitos proibidos

1. **Preparação e testes offline:** podem continuar na PR #193 e em
   emuladores fictícios; não marcam nenhuma decisão como aprovada.
2. **Revisão humana de política:** registrar decisões, motivação, responsável,
   data e risco residual; revisar antes de qualquer abertura do Firebase QA.
3. **Autorização específica de QA:** não é inferida de um teste verde ou
   desta minuta; exige revisão do conjunto de regras e dos dados de teste,
   separação do Firebase, prevenção de menores e plano de rollback.
4. **Autorização independente para produção:** requer homologação física,
   revisão de segurança/privacidade, plano de migração/OTA e aval explícito.
   Nenhum merge em `main` ou Release automático.

**Não realizar agora:** alterar `minorPolicyApproved` na nuvem, implantar
regras candidatas, habilitar FCM, inserir credenciais no repositório, conectar
`atrio-qa-geral` a produção, ativar retenção automática ou apagar históricos.

Referências internas: issue #200, issue #199, issue #201,
`docs/atrio-conversas-retencao-homologacao.md` e
`docs/atrio-conversas-termux-firebase-qa.md`.

### Registro futuro de deliberação

- Responsável pela decisão: **não preenchido**.
- Data e versão do parecer: **não preenchidas**.
- Avaliação jurídica/privacidade: **não apresentada**.
- Escopo autorizado (QA ou produção): **nenhum**.
- Decisão de ativação: **NÃO AUTORIZADA**.

Até essas decisões serem aprovadas, a barra de progresso do ambiente QA
permanece **2 de 7 marcos (29%)**; a etapa 3 segue em preparação.
