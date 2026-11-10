# Átrio Conversas — proteção de menores e retenção (minuta)

**Não é política publicada nem parecer jurídico. Nenhum prazo de
exclusão foi aprovado.**

## Proteção etária

O ECA Digital (Lei 15.211/2025), vigente desde 17 de março de 2026,
e a LGPD exigem atenção à segurança e à privacidade de crianças e
adolescentes. Fontes oficiais:
- https://www.gov.br/anpd/pt-br/assuntos/eca-digital/
- https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm

A elegibilidade de grupo depende de revisão administrativa registrada em
`users/{uid}/chatGroupAccess/eligibility` com `status=approved`,
`policyVersion` e `reviewExpiresAt` futuro. Firestore, Worker e
interface verificam vencimento. O usuário não pode conceder ou renovar
essa autorização. **Isso não implementa verificação de idade**.
É necessário decidir e homologar um mecanismo confiável de aferição
compatível com as leis e o público-alvo antes de ativar grupos.

Não pedir CPF, documentos ou data de nascimento dentro das conversas
como substituto improvisado de aferição de idade. O registro operacional
de autorização usa apenas status, versão e vencimento; eventual
integração futura terá avaliação de finalidade e minimização de dados.

## Diretrizes atuais para escolher a aferição de idade

Referência adicional da ANPD (28/10/2026): Guia Orientativo sobre
escopo e obrigações gerais do ECA Digital:
https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-que-esclarece-quem-deve-cumprir-e-quais-sao-as-responsabilidades-das-plataformas-na-protecao-de-criancas-e-adolescentes

A aplicação das obrigações deve ser analisada conforme o público,
a natureza do serviço, suas funcionalidades e riscos. Como o Átrio
permite mensagens privadas, convites e grupos, a avaliação precisa
cobrir interação entre usuários, contato não solicitado, aliciamento,
denúncias, exclusão de conta e eventual supervisão de responsáveis.
Aferição de idade, supervisão, moderação e privacidade são
medidas diferentes; nenhuma pode ser substituída apenas por
`minorPolicyApproved=true` ou `reviewExpiresAt` futuro.

**Condições para aprovar a integração futura (não implementada):**
1. Documentar público-alvo, faixas etárias permitidas e a política
   de uso para crianças, adolescentes e responsáveis.
2. Escolher método confiável e proporcional de aferição de idade,
   sob avaliação jurídica e de privacidade. Não confiar em campo
   autodeclarado de aniversário como prova.
3. Definir como o servidor receberá uma *resposta mínima* de
   elegibilidade de fonte confiável, sem repassar documentos ou
   dados biométricos ao chat/Firestore de mensagens.
4. Implementar expiração, revogação, revisão humana, contestação
   e registro limitado da decisão, sem persistir identificadores
   do fornecedor no aplicativo público.
5. Exigir testes com acesso não autorizado, resposta antiga,
   conta trocada, token falsificado e provedor fora do ar.
   Todo estado indeterminado deve impedir a abertura do chat.
6. Somente após auditoria técnica, aprovação legal e validação
   operacional, analisar ativação controlada no Firebase.

A escolha do fornecedor, de seu custo, dos prazos de autorização
e do mecanismo de supervisão ainda depende de decisão expressa
do responsável pelo projeto. Nenhuma nova dependência paga foi
adicionada.

## Inventário pendente de política específica

- `chats/{id}/messages`: textos privados, edições e mensagens removidas.
- `chat_groups/{id}/messages`: históricos inclusive encerrados.
- `chat_group_reports`: cópias e motivos de denúncias.
- `users/{uid}/chatHidden`: ocultação não equivale à exclusão.
- `chat_groups/{id}/atrioGroupInvites`: convites e recusas.
- `users/{uid}/chatGroupAccess`: decisões de acesso e vencimento.

## Ferramenta não destrutiva

O módulo `cloudflare/push-worker/src/retention-plan.js` é uma
função **pura, sem rede, credenciais, Firebase ou exclusão**.
Uma política não aprovada produz zero candidatos. Uma política
simulada com prazo explícito calcula apenas o total de grupos
encerrados a revisar, excluindo denúncias abertas e impedimentos
legais. Não retorna IDs, nomes nem mensagens. Sempre informa
`deletedCount: 0`.

A política real deve definir prazos diferentes para mensagens,
denúncias, convites e registros administrativos, critérios de
retenção legal, exercício de direitos e descarte seguro. Excluir
um documento pai no Firestore não exclui automaticamente suas
subcoleções. Não criar jobs de exclusão antes de aprovação
expressa, auditoria e homologação.

**Permanecem bloqueados:** tanto chat individual como grupos exigem
a configuração `minorPolicyApproved=true` e a versão de revisão
`safetyReviewVersion=2026-11-safety-v1` no chat individual. São
travas técnicas de homologação, não prova real de idade. Continuam
pendentes o procedimento de aferição etária, os avisos sem
`pushEnabled=true`, qualquer exclusão automática e qualquer
mudança nas regras Firebase de produção.


## Moderação de mensagens privadas — processo proposto, sem aprovação de lançamento

A administração acessa **somente protocolos de denúncia** em
`chat_reports` e `chat_group_reports`, cada qual contendo
o ID da mensagem apontada, motivo, trecho reportado e criação.
A função `isAdmin()` exige registro `admins/{uid}` **habilitado
por Console/Admin SDK**, nunca por autodeclaração.
As regras não permitem ao moderador abrir `chats/{id}/messages` nem
`chat_groups/{id}/messages` apenas por ser administrador. A conta
que denunciou consegue consultar seu protocolo, mas não listar
protocolos de terceiros. Documentos de denúncia são imutáveis
pela API cliente, inclusive para administradores.

**Regra de contenção de incidente:** ao desativar o chat globalmente,
o histórico privado deixa de ser acessível, mas os protocolos já
registrados continuam legíveis pelo denunciante e pela moderação
credenciada. Não existe rotina automática de apagar provas.
Esses limites estão cobertos por testes de regras no emulador.

### Fluxo de análise que ainda depende de aprovação operacional

1. Receber o protocolo privado, sem navegar livremente pelo histórico.
2. Triar gravidade, risco a menores, ameaças e spam; definir responsáveis
   e prazos por uma política específica ainda não aprovada.
3. Preservar evidências relevantes de forma mínima, auditável e com
   restrição de acesso, respeitando impedimentos legais e privacidade.
4. Revisão humana com decisão registrada em recurso administrativo
   **fora das permissões de escrita do APK**; estabelecer contestação e
   proteção contra denúncia abusiva.
5. Quando houver suspeita de risco imediato, aplicar processo de
   escalonamento apropriado definido por responsáveis competentes.
   Não pressupor poderes de investigação nem leitura geral de DMs.
6. Não apagar mensagens, subcoleções, protocolos ou backups por
   cronômetro improvisado. Os prazos, categorias e fundamento jurídico
   exigem decisão expressa e validação profissional.

**Decisões pendentes:** público-alvo e aferição de idade, canal e
responsáveis pela moderação, tratamento de denúncias de ex-membros de
grupos, retenção de cada coleção, solicitação de eliminação e
preservação legal. Até defini-las, manter os gates de chats/grupos
fechados na produção.

**Atenção:** os testes abaixo não implementam painel administrativo,
tratamento jurídico nem triagem automática; apenas comprovam que
o cliente não ganha acesso aos dados privados por ser moderador.
