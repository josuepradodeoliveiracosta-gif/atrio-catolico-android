# Átrio Católico — Termos de Uso e Política da Comunidade

**MINUTA INTERNA PARA REVISÃO — NÃO PUBLICAR, NÃO EXIBIR COMO POLÍTICA VIGENTE.**
Versão técnica proposta: `community-v1` (compatível com o validador de aceite do Android e com `acceptedTerms/{version}` no Firestore).
Data de vigência: [A definir após aprovação].
Operador/responsável e canal público de contato: [A confirmar].
Endereço da política de privacidade: [A confirmar].
A implementação de aceite e sua exigência nas regras do backend **ainda não estão concluídas**.

## 1. Sobre a comunidade

O Átrio Católico é uma plataforma para discussões, reflexões e convivência relacionadas à fé católica. Os conteúdos publicados são de responsabilidade dos participantes que os produzem. Não atribuir endosso formal da Igreja, de dioceses ou instituições sem autorização específica e comprovável.

A comunidade acolhe opiniões e perguntas em ambiente respeitoso. Divergências religiosas não justificam assédio, ameaças, fraude, exposição de dados pessoais ou tratamento discriminatório.

## 2. Cadastro e publicações

O participante deve utilizar uma conta de sua titularidade, respeitar os requisitos de idade aplicáveis e não se passar por sacerdote, diácono, moderador, fundador ou qualquer pessoa real. Selos e títulos exibidos no aplicativo precisam de política de verificação própria; não são licença para intimidar outras pessoas.

Publicações, respostas, imagens e interações podem ficar visíveis a outros membros conforme as configurações do serviço. Antes de criar ou enviar conteúdo, cada participante deverá ler e aceitar expressamente estes Termos, com registro de versão e momento do aceite; o sistema não deve aceitar publicações sem esse registro válido.

## 3. Conteúdos e condutas proibidos

Não são permitidos:
- Ameaças, perseguição, incentivo à violência, assédio, intimidação, discurso de ódio e ataques pessoais.
- Material sexual ilegal, exploração infantil, conteúdos violentos ilícitos ou promoção de atividades ilegais.
- Exposição de dados pessoais de outras pessoas sem autorização, tentativa de obter senhas, CPF, documentos, localização privada ou informações sigilosas.
- Perfis falsos, personificação de autoridades religiosas, fraude, golpes, links maliciosos e pedidos enganosos de pagamento/doação.
- Spam, publicidade abusiva, automação não autorizada e manipulação de interações.
- Publicação de imagens ou textos sem os direitos de uso aplicáveis, incluindo violações de privacidade e de direitos autorais.
- Denúncias sabidamente falsas para prejudicar outro usuário.

**Moderação contextual:** críticas, dúvidas, debates e discussões legítimas podem ser permitidos; a moderação deve distinguir divergência de assédio, sem prometer avaliações automáticas infalíveis.

## 4. Denúncia, bloqueio e moderação

Os participantes devem poder denunciar conteúdo e usuários e bloquear outros membros pelo aplicativo. A equipe poderá analisar denúncias e, conforme gravidade e contexto, ocultar conteúdo, restringir recursos, suspender perfis ou tomar outras medidas proporcionais. Ações de alto impacto precisam de controles e, quando cabível, possibilidade de recurso.

Não prometer prazo de resposta, remoção automática ou anonimato absoluto sem comprovar os procedimentos e o desenho de dados. O denunciado não deve receber a identidade do denunciante no fluxo ordinário.

A implementação técnica de denúncia, bloqueio e recursos deve respeitar regras de acesso e permitir auditoria mínima. A moderação automática, quando existente, deve ser limitada e supervisionada.

## 5. Dados pessoais e exclusão

Tratamento, finalidade, retenção, direitos do titular e mecanismo de exclusão de conta/dados devem estar descritos na Política de Privacidade pública e em recurso web efetivo. Solicitar exclusão não significa que a conta já foi eliminada. A exclusão real, o contato e os prazos estão **pendentes de homologação** e não podem ser anunciados como disponíveis nesta minuta.

## 6. Responsabilidade e atualizações

O participante deve respeitar a lei e as regras aplicáveis. As políticas poderão mudar, e revisões que alterem substancialmente os deveres de publicação deverão exigir aceite da nova versão antes de novo conteúdo. A moderação deve buscar proporcionalidade e registro de decisões, sem prometer disponibilidade contínua do serviço.

## 7. Critérios de aprovação antes de exibir estes Termos

- [ ] Confirmar operador, endereço de contato público, idade mínima, público-alvo, classificação e política de privacidade.
- [ ] Revisar adequação à LGPD, especialmente dados capazes de revelar religião.
- [ ] Rever política de revisão de selos clericais, conteúdo e recursos de moderação.
- [ ] Definir versão final e URL acessível dos Termos; não usar placeholder público.
- [ ] Implementar UI de aceite antes da primeira postagem/resposta e versão no Firestore sob Rules restritivas.
- [ ] Validar que conta sem aceite não publica por cliente antigo, REST, offline ou pela API.
- [ ] Exercitar denúncia, bloqueio, revisões e notificações com dois perfis de teste.
- [ ] Registrar evidências reais na matriz UGC da PR #71, mantendo `verified:false` até a homologação.

Política de referência: https://support.google.com/googleplay/android-developer/answer/9876937


## Preparação técnica da página estática (sem publicação)

A geração da página final, depois da revisão real do responsável e da análise jurídica, usa
`cloudflare/account-deletion-support/community-terms.mjs`. A minuta acima **não é** conteúdo
aprovado e não é automaticamente incorporada. É obrigatório fornecer, em um arquivo JSON
privado, `appName`, `controller`, `supportEmail`, `version`, `effectiveDate`, `privacyUrl`,
`sections` (`about`, `userContent`, `prohibited`, `reporting`, `moderation`,
`privacy`, `minors`, `updates`) e metadados reais `approvedBy`, `reviewedAt`,
`approval: community-terms-owner-and-legal-reviewed`.

No Termux, na branch de desenvolvimento, somente **depois** de aprovada a redação:

```bash
ATRIO_COMMUNITY_TERMS_INPUT="$HOME/atrio-termos-revisados.json" \
  node cloudflare/account-deletion-support/community-terms.mjs
```

A saída local será `cloudflare/account-deletion-support/terms-dist/termos/community-v1/index.html`.
Não enviar arquivo privado ao GitHub. A confirmação de revisão do JSON é apenas um
controle de entrada, **não** prova verificação jurídica independente. O gerador não
faz deploy. Publicar o HTML aprovado sob HTTPS e conferir em navegador anônimo;
configurar `app_config/community_terms` com `enforce=true`, `published=true`,
`version=community-v1`, `url` HTTPS validada **somente após** homologação e controle
de alterações. Nunca ativar os termos em produção usando um rascunho.

A política Google Play exige aceite antes de conteúdo criado por usuários,
denúncia, bloqueio e moderação contínua. Publicar a página não habilita,
por si só, lançamento, exclusão de conta, assinaturas ou evidências UGC.
