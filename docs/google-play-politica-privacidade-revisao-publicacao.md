# Átrio Católico — preparação da política de privacidade pública

**Atualizado em 02/11/2026 · RASCUNHO INTERNO · NÃO PUBLICAR.**
PR #71 (QA), sem autorização de assinatura, de site ou de produção.

## Identificação do responsável — decisão do titular em 02/11/2026

O titular confirmou que o Átrio Católico será identificado por **pessoa física**, usando seu próprio nome pessoal como responsável/controlador, e não por uma empresa registrada.

**Campo ainda pendente:** grafia exata do **nome civil completo** para exibição pública. O nome preferido, o nome de usuário do GitHub ou um nome inferido de contas não substituem a identificação confirmada pelo titular. Não incluir CPF, documentos pessoais, endereço residencial ou outros dados além do necessário.

A escolha por pessoa física **não equivale** a revisão da política, confirmação de base legal, publicação do site ou autorização de assinatura do AAB. Conservar os bloqueios de publicação até a conclusão dessas etapas.

## Por que a página ainda não está publicada

A Google Play exige política de privacidade abrangente em **URL pública
ativa, acessível globalmente, não editável por visitantes e que não seja
um PDF**, acessível na ficha da loja e no app. A LGPD considera
**convicção religiosa** um possível dado pessoal sensível. Não basta
afirmar genericamente que o aplicativo "respeita a privacidade".

O e-mail público de contato foi criado e seu recebimento foi testado
pelo responsável: **atriocatolico.privacidade@gmail.com**. Essa
confirmação não determina o nome jurídico do controlador, nem a base
legal de dados sensíveis, retenção ou a existência de um executor de
exclusão de contas em produção.

## Material técnico preparado

`cloudflare/account-deletion-support/privacy-policy.mjs` transforma
um documento JSON **aprovado pelo responsável e por revisão adequada**
em `policy-dist/privacidade/index.html`, uma página HTML estática,
com cabeçalhos restritivos em `_headers`.

**Não há deploy, conta de produção, chave, Firebase nem rede** nesse
gerador. A aprovação exigida é
`"policy-owner-and-legal-reviewed"` e um revisor com data UTC
comprovável, não um valor obtido automaticamente.

A página exige todos os campos abaixo (texto final da operação real):

| Campo JSON | Informação a comprovar antes da revisão |
| --- | --- |
| `appName` | Nome exato: Átrio Católico |
| `controller` | Nome público do responsável/controlador da operação |
| `email` | Contato: atriocatolico.privacidade@gmail.com |
| `effectiveDate` | Data real de vigência YYYY-MM-DD |
| `dataCategories` | Dados coletados, associados à conta e ao aparelho |
| `purposesAndBases` | Finalidades e hipóteses legais **por categoria** |
| `religiousData` | Dados sobre convicções religiosas e salvaguardas |
| `publicVisibility` | Quais publicações, fotos e perfis ficam públicos |
| `providers` | Prestadores reais, dados envolvidos, compartilhamentos |
| `internationalTransfers` | Fluxos internacionais e seus mecanismos |
| `security` | Controles efetivos de segurança e acesso |
| `retention` | Prazos de guarda e justificativas por classe |
| `deletion` | Caminho para pedidos, processamento real e exceções |
| `individualRights` | Direitos dos titulares e como exercê-los |
| `minors` | Política de idade e proteção de crianças/adolescentes |
| `contactProcedure` | Recebimento, validação segura e resposta |
| `approvedBy` | Identificador do revisor responsável |
| `reviewedAt` | Data/hora UTC efetiva da revisão, ISO 8601 |
| `approval` | Valor de aprovação explícito após revisão real |

Os testes usam apenas textos fictícios e temporários, nunca como
declarações públicas da organização.

## Comandos Termux após a revisão (NÃO executar ainda)

No clone da branch QA, em uma pasta privada **fora do repositório**,
guardar um JSON com todos os campos verdadeiros, sem tokens ou senhas.
Conferir a revisão e então executar:

```bash
export ATRIO_PRIVACY_POLICY_INPUT="$HOME/atrio-privacidade-aprovada.json"
node cloudflare/account-deletion-support/privacy-policy.mjs
```

O comando **falha fechado** diante de configuração ausente, campos
não preenchidos, aprovação ausente, texto "a definir",
"placeholder", data inválida ou tentativa de sobrescrita.
A saída é **local**, não publicada. Não inclua em nenhuma PR os
dados privados ou minutas de revisão desnecessárias.

## Verificação externa ainda obrigatória

- Reconciliação completa entre código e infraestrutura ativa:
  Firebase Auth, Firestore, Push/FCM, Guardião e moderação, mídia
  Cloudinary, Cloudflare/D1, pedidos de exclusão, logs e back-ups.
- Bases jurídicas específicas, inclusive as de dados sensíveis,
  com revisão da proteção de menores e eventuais transferências.
- Política verdadeira de retenção e exclusão que reflita a
  capacidade *real* do backend. Nenhuma promessa de remoção
  automática até comprovar o executor e o atendimento supervisionado.
- Revisão da ficha **Segurança dos dados** coerente com o AAB final.
- Hospedagem HTTPS e teste público em navegador sem login.
  **Cloudflare Pages QA está criado, sem deployment**, e não pode
  substituir o domínio público homologado.

A ferramenta verifica apenas **estrutura e aprovação declarada**,
não valida o mérito jurídico, as informações do responsável, o prazo
de resposta ou a veracidade do backend.

Fontes oficiais:
- https://support.google.com/googleplay/android-developer/answer/10144311
- https://support.google.com/googleplay/android-developer/answer/13327111
- https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes
