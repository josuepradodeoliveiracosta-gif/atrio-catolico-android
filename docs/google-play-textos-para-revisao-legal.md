# Átrio Católico — textos estruturados para revisão antes da Play

**Estado: RASCUNHOS INTERNOS, NÃO PUBLICAR.** Este material não aprova uma política, não comprova LGPD, não implanta o site, não habilita exclusão de contas e não altera os manifestos de evidência.

## Entregas desta revisão

Os arquivos `google-play-politica-privacidade-candidata.json` e `google-play-termos-comunidade-candidato.json` fornecem **conteúdo substantivo em português** nos campos exatos exigidos por `cloudflare/account-deletion-support/privacy-policy.mjs` e `community-terms.mjs`. O campo técnico de versão da comunidade já corresponde a `community-v1`, sujeito à publicação e à configuração de versão no backend.

Ambos os modelos têm `approval: null`, `approvedBy: null`, `reviewedAt: null` e `effectiveDate: null` de propósito. Os validadores rejeitam esses arquivos; **não basta atribuir valores fictícios para publicá-los**. A URL da política nos Termos também permanece `null` até existir endereço HTTPS definitivo.

## Decisões que faltam antes da primeira publicação

1. **Base legal e dados religiosos:** registrar as hipóteses legais específicas da LGPD, a sensibilidade das informações publicadas e os controles de minimização e consentimento quando aplicáveis.
2. **Retenção:** aprovar prazos e fundamentos para perfis, imagens, posts, respostas, tokens, denúncias, registros do Guardião e comprovantes administrativos; decidir o tratamento de referências de terceiros.
3. **Exclusão efetiva:** homologar o processamento completo Auth/Firestore/Cloudinary/FCM/D1, os casos legalmente retidos, o atendimento manual e o retorno ao titular. Hoje o processo de produção não está homologado.
4. **Fornecedores e transferências:** comprovar serviços ativos, localização, contratos e transferências internacionais; cruzar com o formulário Segurança dos dados.
5. **Menores e UGC:** definir público-alvo, faixa etária e controles que serão realmente habilitados; homologar denúncia, bloqueio, moderação e aceite pré-postagem.
6. **Site e revisão:** escolher HTTPS público definitivo, confirmar contato operacional e registrar revisão do responsável e assessoramento jurídico com datas verdadeiras.

## Passagem para o gerador estático

Após concluir as decisões e ajustar o texto ao funcionamento **comprovado** do app, copiar os dois JSON para uma pasta privada, fora do repositório. Somente o responsável pela revisão deverá preencher a vigência, URL pública, metadados verdadeiros e **aprovações expressas**. Os valores esperados pelos validadores são `policy-owner-and-legal-reviewed` e `community-terms-owner-and-legal-reviewed`, mas esses textos não substituem a aprovação real.

O gerador `cloudflare/account-deletion-support/site-bundle.mjs` poderá então produzir os quatro arquivos do site **offline**, desde que os valores de `ATRIO_DELETION_SITE_ORIGIN`, `ATRIO_DELETION_PRIVACY_URL`, `ATRIO_PLAY_COMMUNITY_TERMS_VERSION` e do e-mail coincidam. O resultado **não é um deploy**.

Não incluir dados pessoais de solicitantes, tokens, senhas, chaves, certificações fabricadas ou aprovações automáticas nos JSON. Não marcar `verified:true` ou `releaseAuthorized:true` no repositório com base somente nessas minutas.

## Base de reconciliação

Material extraído de `docs/google-play-politica-privacidade-minuta-nao-publicar.md`, `docs/google-play-termos-comunidade-minuta-nao-publicar.md` e da matriz `docs/google-play-seguranca-dados-matriz-revisao.md`. A revisão deve considerar também as diferenças entre código proposto na PR, serviços atualmente implantados e a versão Android que será efetivamente submetida.

**Aprovação final, hospedagem pública, assinatura e Play Console continuam pendentes.**
