# QA de 18 anos — persistência e consumo único (laboratório)

**Estado: exclusivamente offline, sintético e sem implantação.**
Este experimento complementa, mas NÃO substitui, o contrato criptográfico
`firebase/qa-general/age18-attestation-contract.mjs` e o modelo de sessão
`firebase/qa-general/age18-binding-lab.mjs` da PR #193.

## Risco identificado

Os modelos anteriores guardavam desafios `nonce` e identificadores `jti`
em `Map`/`Set`, que não sobrevivem a reinícios e não são compartilhados
entre múltiplas instâncias. O backend futuro exige uso único durável e atômico.

## Contrato experimental implementado

`scripts/qa_age18_single_use.py` simula SOMENTE o estágio posterior a
uma hipotética autenticação e validação de um atestado fictício.
Utiliza arquivo SQLite local e transações `BEGIN IMMEDIATE`,
identificadores únicos, marcação permanente de desafios consumidos,
invalidação em reemissão, expiração e vínculo a conta/sessão sintéticas.
O método de consumo não verifica assinatura nem token: qualquer chamador
poderia mentir, portanto é PROIBIDO reutilizá-lo em Worker real ou backend.

Os oito testes criam um banco temporário isolado, abrem novas conexões,
tentam replays após reabertura, trocam contas/sessões, verificam colisões,
relógio regressivo, prazo vencido, indisponibilidade e doze concorrentes
acessando o mesmo nonce. Exatamente um consumo pode triunfar.

Este laboratório não cria `chatAgeEligibility/current`, não importa
dados ou credenciais reais, não habilita o chat, não usa Firebase real,
Cloudflare, FCM, deploy nem dados de pessoas.

## O que ainda falta para o marco 3

- Escolha e aprovação de aferição etária 18+ confiável e proporcional.
- Sessão Firebase autenticada pelo servidor, fornecedor e chaves confiáveis,
  autorização explícita e auditoria de risco/LGPD.
- Atomicidade no banco realmente escolhido para produção/QA, não SQLite.
- Moderação, denúncias, preservação e retenção aprovadas (#200).
- Revisão das Rules candidatas e autorização específica de deploy QA.

**Marco 3 permanece EM ANDAMENTO / BLOQUEADO POR POLÍTICA;**
progresso oficial do ambiente QA permanece 2/7 = 29%.
Trabalho deve permanecer numa PR draft separada, direcionada à
branch de homologação da PR #193; não há autorização de merge
na `main` ou deploy.
