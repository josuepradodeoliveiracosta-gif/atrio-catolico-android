# Átrio Católico — escopo de testes fechados com participantes adultos

**Registro de declaração do Administrador/Fundador — 11/11/2026.**  
**Natureza:** decisão operacional provisória / delimitação do laboratório QA.  
**Não representa lançamento público, parecer jurídico, certificação de idade, aprovação de rollout nem liberação do Firestore.**

## Situação informada pelo fundador

1. O aplicativo **Átrio Católico ainda não foi lançado ao público**; encontra-se em **fase de testes fechados**.
2. Segundo declaração expressa do fundador, **todos os integrantes do grupo de testes do Átrio são maiores de 18 anos**. Esta é uma informação fornecida pelo responsável sobre a composição do grupo; não foi realizada nesta documentação uma verificação independente das idades de cada participante.
3. Para a fase atual, o fundador **considera suficiente, do ponto de vista operacional desse grupo fechado**, a solução já escolhida: **data de nascimento informada, idade calculada localmente e autodeclaração expressa de maioridade (18+)**.
4. **Não é requisito desta fase contratar um serviço pago de verificação etária.** O objetivo não é implantar um mecanismo de identificação civil ou coletar CPF/documentos por mera precaução.

Essas decisões **estão tomadas**. Não devem ser reabertas como escolha de produto a cada tarefa de QA, salvo alteração do escopo, da composição dos testadores, exigência legal identificada para o caso concreto ou incidente que indique risco não coberto.

## Escopo e limites da decisão

- A suficiência declarada pelo fundador **refere-se à operação de testes fechados com participantes adultos**, e **não** à validação pública, à aceitação de menores ou à elegibilidade verificada de identidade.
- A idade informada e a autodeclaração **não comprovam idade real**. O status técnico deve continuar `declared_18_plus`, nunca `verified_18_plus` ou equivalente que sugira aferição independente.
- A condição de **teste fechado**, por si só, **não cria dispensa automática de obrigações legais**. A aplicabilidade das exigências de proteção de crianças e adolescentes, privacidade e aferição etária ao serviço concreto, inclusive em teste, permanece sujeita a análise apropriada.
- Se houver tentativa de ingresso de menor, ampliação de convites, perda do controle de acesso, abertura a público não conhecido ou mudança de funcionalidades/conteúdo, **suspender qualquer conclusão de suficiência operacional** e revisar as salvaguardas antes de ampliar o acesso.
- O acesso efetivo aos testes deve ser limitado aos integrantes autorizados do grupo. Este documento registra a intenção e o perfil informado, **não certifica que controles técnicos de exclusividade já foram configurados ou auditados**.
- Antes de **lançamento público ou expansão além do grupo fechado**, reavaliar o enquadramento legal e as medidas de aferição de idade proporcionalmente ao risco; documentar eventuais exigências adicionais e obter as autorizações pertinentes.
- O **Administrador/Fundador** continua responsável provisório por toda a moderação; somente moderadores por ele designados poderão receber atribuições. O Guardião V2 segue planejado, **não ativado**.

## Estado técnico verificado separadamente

Na auditoria remota somente leitura exibida pelo operador em 11/11/2026, o projeto `atrio-catolico-qa-geral` manteve o Firestore em **deny-all**; os quatro documentos `app_config` estavam **ausentes**, e uma consulta de IAM retornou 5 das 5 permissões solicitadas. Esses resultados **não significam que conversas reais estejam habilitadas**, nem demonstram funcionamento de controle de acesso exclusivo ao grupo.

A PR #232 permanece em rascunho, sem merge/deploy. A avaliação de lançamento segue **NO_GO**; a barra de ativação QA continua **60% (3/5)** e o QA geral, **29% (2/7)**. Testes offline e o grupo fechado não autorizam mudar `minorPolicyApproved` para `true`, publicar Rules, habilitar grupos/FCM/Worker ou criar dados reais sem aprovação própria.

## Pendências que este registro NÃO encerra

- Revisão jurídica e de privacidade do escopo real do serviço e do possível acesso por menores;
- Governança operacional de denúncias, revisão humana, emergência e recursos;
- Retenção por classe, proteção e acesso a evidências, direitos dos titulares;
- Resultado verde dos Actions do **head exato da PR #232**;
- Autorização expressa e separada para eventual implantação QA e, mais adiante, produção.

**Referências internas:** `docs/qa-homologacao/CHAT-AUTODECLARACAO-18-QA.md`, `docs/qa-homologacao/DIRETRIZ-MODERACAO-HUMANA-TRANSICAO-GUARDIAO-V2.md`, issue #200 e PR #232.

**Regra interpretativa:** registrar `GRUPO_FECHADO_ADULTO_DECLARADO_PELO_FUNDADOR` como contexto informado, **não** como prova de identidade de cada participante, dispensa jurídica generalizada ou autorização técnica de ativação.
