# Preparação da escolha de verificador de maioridade 18+

**Status: FORNECEDOR NÃO SELECIONADO; NÃO É PARECER JURÍDICO.**

A idade mínima 18+ para mensagens individuais e grupos já é um
requisito do fundador. A data autodeclarada no cadastro é somente
pré-triagem local e **não é prova de maioridade**. Não aceitar CPF
digitado no chat ou idade informada sem verificação independente.

## Alternativas para decisão (sem fornecedor aprovado)

| Abordagem a avaliar | Pontos a verificar | Limites |
| --- | --- | --- |
| Sinal de idade autenticado de sistema/loja | Disponibilidade no Android, prova de integridade, assinatura, vínculo UID, cobertura e revogação | Nenhum sinal foi comprovado como disponível/adequado ao Átrio |
| Terceiro especializado em verificação etária | Contrato, data center, LGPD, qualidade, prova mínima 18+, custos, recusa e recurso | Não integrar fornecedor antes de diligência |
| Identidade digital com resposta mínima de maioridade | Autorização e integração permitidas, consentimento/base legal, vínculo e segurança | Não presumir integração pública disponível |

## Critérios eliminatórios e perguntas para proposta

- Identidade Firebase REAL autenticada pelo servidor e resposta
  de fornecedor confiável vinculada ao UID e à sessão vigente.
- Prova minimizada, autenticada e curta: issuer/audience/chave fixa,
  nonce imprevisível, JTI de uso único, consumo atômico persistente,
  expiração e revogação. Testes de token fraudado e troca de conta.
- Sem CPF, fotos, biometria, documentos ou data de nascimento no
  Firestore de conversas, logs do APK ou Workers de notificação.
- Se houver dados biométricos processados por fornecedor, avaliar
  riscos próprios da técnica e plano de não retenção no aplicativo;
  não presumir que biometria seja obrigatória ou desejável.
- Conferir controlador/processador, suboperadores, transferências,
  finalidade, base jurídica, exclusão, incidentes, recurso e
  acessibilidade. Revisão jurídica/privacidade específica.
- Preço por aferição, cotas, latência, falhas, disponibilidade,
  monitoramento, contrato de tratamento e plano de saída.
- Testar indisponibilidade do fornecedor, expiração, logout,
  reemissão, reuso de JTI, troca de UID, rate limit e concorrência.
- Pilotar apenas no Firebase QA (projeto distinto), depois de
  autorização humana e revisão de Rules, Workers, D1 e rollback.

## Acompanhamento governamental

Referências oficiais consultadas em 10/11/2026:

- ANPD, página ECA Digital e calendário de aferição de idade:
  https://www.gov.br/anpd/pt-br/assuntos/noticias/eca-digital
- ANPD, orientações preliminares de março de 2026:
  https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-orientacoes-preliminares-e-cronograma-para-afericao-de-idade-no-ambiente-digital
- ANPD, guia de escopo e obrigações gerais de 28/10/2026:
  https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-que-esclarece-quem-deve-cumprir-e-quais-sao-as-responsabilidades-das-plataformas-na-protecao-de-criancas-e-adolescentes

A regulamentação e a adequação devem ser avaliadas no momento
da contratação; o checklist não substitui análise legal.

## Checklist automatizado, sem falsa aprovação

O arquivo `IDADE18-FORNECEDOR-NAO-SELECIONADO.json` contém 20
critérios sem evidência. O validador aceita apenas os campos e tipos
esperados e rejeita declarações de seleção ou implantação.
Uma matriz com todos os indicadores artificialmente `true`
continua **NO-GO**, pois evidência autenticada e aprovação humana
não surgem do preenchimento de um JSON.

Este trabalho não cria credenciais, contratos nem conexão externa;
não integra nenhum verificador real, não concede maioridade, não
altera produções nem decide exclusões. A issue #200 continua aberta.

**Marco 3 bloqueado; QA 2/7 (29%).**
