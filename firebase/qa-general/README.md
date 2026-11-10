# Firestore de homologacao geral - candidato offline

Projeto alvo: atrio-catolico-qa-geral. Nenhuma credencial e armazenada aqui.

O banco QA real foi criado pelo operador com regras de negacao total.
**Nao alterar essas regras reais nesta etapa.**

O script compose-rules.mjs gera um arquivo de regras de teste sem ler a
politica geral firestore.rules da producao. Reutiliza APENAS os fragmentos
de chats e grupos ja separados, mais funcoes basicas de Auth, bloqueios
privados e leitura pontual de nomes publicos. Outros caminhos sao negados.
A regra de verificacao de e-mail e mais estrita para a homologacao.
Os gates de menores e elegibilidade continuarao bloqueados quando ausentes.
A suite de emulacao usa somente projeto demo-atrio-v11 e dados ficticios,
inclusive revisoes de politica sinteticas (nao sao aprovacoes reais).

Executar localmente apenas para gerar as regras, SEM PUBLICAR:
  node firebase/qa-general/compose-rules.mjs

Arquivo de saida ignorado: tests/security/qa-general.generated.rules.
A CI qa-general-firestore.yml testa suas permissoes em emulador isolado.

NAO fazer deploy agora. A revisao de menores, retencao, moderacao,
regras QA e identidade APK/Worker ainda e necessaria antes de autorizar
ativacao de chats, grupos ou notificacoes FCM. Nao importar dados reais,
usuarios oficiais nem copiar firestore.rules da producao.

**Revisão de segurança QA (08/11):** o gerador altera apenas a âncora
`chatEnabled()` na cópia **em memória** do fragmento de conversas, para
exigir e-mail verificado inclusive em preferências, solicitações e grupos.
Se essa âncora mudar ou desaparecer, o gerador aborta. O fragmento original
e as regras de produção não são modificados. A suíte valida a recusa de uma
conta fictícia com e-mail não verificado.

**Auditoria remota opcional, SOMENTE leitura:** no clone Termux atualizado,
`node scripts/termux-firestore-qa-readonly.mjs` consulta duas vezes a API
de regras do projeto fixo `atrio-catolico-qa-geral` (uma release e um
ruleset) e informa apenas SHA-256 e se ainda está em deny-all. Falha de
permissão ou diferença nas regras não autoriza deploy. Nenhum segredo é
publicado. O Worker QA continua bootstrap bloqueado.

## Experimento paralelo de paridade com a base versionada — somente offline

**NÃO é configuração do Firebase QA publicado.** O gerador
`compose-parity-rules.mjs` combina, exclusivamente em memória, o
`firestore.rules` versionado e revisado no GitHub com os fragmentos de
conversas e grupos da PR #193. Ele mantém o arquivo original intacto e
acrescenta as rotas experimentais **antes** do `deny-all` final, sem
retirá-lo. O portão de e-mail confirmado é obrigatório no novo chat.

- A versão de referência é fixada pelo SHA do **Git blob** do
  `firestore.rules` de `main` em 09/11/2026:
  `526b8a1e7ff09aca79a4a539ee1681a6c0a76f77`.
  Qualquer mudança exige revisão manual; a geração falha fechada.
- O gerador rejeita mudanças na estrutura-base, funções duplicadas,
  conflitos das rotas críticas, abertura literal de permissão nos
  fragmentos e ausência de portões administrativos.
- `compose-parity-rules.test.mjs` confirma que **todo o texto da base
  permanece idêntico fora da inserção**. A suíte separada
  `qa-parity-firestore.test.mjs` roda no projeto **`demo-atrio-v11`**
  do Firebase Emulator e comprova acessos legados e negações de chat.
- Artefato local ignorado no Git:
  `tests/security/qa-parity.generated.rules`. Não usar com
  `firebase deploy`. O gerador **não** faz chamada de rede.
- **Atenção:** regras de caminhos sobrepostos no Firestore permitem
  acesso quando **qualquer** `allow` coincide. Logo a composição
  não é aprovada apenas por ser aditiva. Revisão humana + matriz
  de negativas em todas as coleções ainda são exigidas.

**Etapa obrigatória antes de QUALQUER publicação no Firebase QA:**
verificar por consulta read-only a release realmente implantada no
Firebase de produção (`atrio-catolico`) e compará-la ao blob
versionado. O utilitário
`scripts/termux-firestore-rules-diff-readonly.mjs` existe na
`main`, mas **não foi executado nesta etapa** e o mesmo hash no
GitHub **não comprova identidade com a nuvem**. Se divergir,
não implantar nem tentar corrigir automaticamente: investigar,
registrar nova base, rever regras sobrepostas e repetir os testes.

A homologação com QA real depende de autorização explícita, revisão
da política etária/moderação/retenção na issue #200, critérios de
LGPD, auditoria e rollback. **Não importar dados reais, credenciais
nem usuários de produção; não publicar regras, habilitar FCM ou
alterar backups.** Este experimento não substitui o laboratório
restritivo atual, que continua sendo o padrão seguro.

## Idade mínima 18 anos — protocolo sintético exclusivamente offline

O fundador alterou a idade mínima para o chat para **18 anos completos**
em 10/11/2026. A decisão anterior, de 16 anos, não está mais vigente.
Os dois geradores de Rules offline exigem a função
`qaChatAge18Eligible(request.auth.uid)` e o documento
`users/{uid}/chatAgeEligibility/current`.

Os testes usam apenas `status=eligible`, `minimumAge=18`,
`policyVersion=2026-11-18plus-qa-v1` e `reviewExpiresAt` futuro.
O usuário não pode criar, alterar, renovar ou excluir o documento.
A versão sintética anterior (limiar 16) não concede acesso ao chat.
Testes adicionais tentam apresentar (a) uma prova 16+ da política antiga
e (b) limiar 18 com versão antiga. Ambos devem negar DMs, histórico de
grupos e novos convites. Denúncias preexistentes permanecem acessíveis
ao autor conforme regras próprias, sem abrir conteúdo privado.

A fixture é um **atestado administrativo fictício** no Firebase Emulator,
não uma comprovação de idade. O campo `minimumAge=18` representa a
afirmação de que o participante alcançou o limiar, **não a idade exata**.
Não coletamos CPF, documentos nem fotos da identidade.

Os testes recusam idades-limiar 16 e 17, versão errada, revogação,
expiração e prova ausente, e validam um caso 18+ de controle positivo.
A restrição também protege histórico, mensagens e convites por meio dos
demais gates. Protocolos anteriores de denúncia conservam as regras
próprias de privacidade sem reabrir mensagens.

**NUNCA fazer deploy das regras candidatas ou criar provas sintéticas no
Firebase real.** Faltam método de aferição confiável, revisão legal,
moderação, retenção, privacidade e autorização de QA pela issue #200.
Na última auditoria, Firebase QA real ainda estava deny-all e Worker QA
em bootstrap fechado.

## Bloqueio de contato com destinatários inelegíveis — candidato offline

Além de exigir elegibilidade para quem opera o chat, os geradores QA
agora exigem a prova sintética do **destinatário** para criar uma conversa,
de **ambos os participantes** para gravar uma mensagem e de quem recebe
o convite para criar ou atualizar convites de grupos. A origem oficial
dos fragmentos é preservada; mudanças nas âncoras auditadas interrompem
a geração, sem tentar corrigir silenciosamente.

O Firebase Emulator testa a mesma solicitação de conversa e o mesmo
envio atômico: falham com a elegibilidade do destinatário ausente ou
revogada e passam quando a fixture válida é restaurada. A cobertura
estática confere a injeção dos requisitos de convites em ambos os
candidatos. Isso **não** é prova de idade, não implementa política de prevenção de
contato com menores, nem homologa fluxos reais de grupos.
