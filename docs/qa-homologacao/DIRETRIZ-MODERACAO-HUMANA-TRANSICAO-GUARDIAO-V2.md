# Átrio Católico — decisão de responsabilidade da moderação e transição para Guardião V2

**Decisão expressa do Administrador/Fundador — 11/11/2026.**  
**Estado da decisão funcional: DEFINIDA. Estado da implementação/ativação: NÃO INFERIDO.**  
**Escopo: toda a moderação do aplicativo Átrio Católico**, incluindo
comunidade, discussões e respostas e, quando habilitados, conversas
individuais, grupos, denúncias e recursos. Esta diretriz não se limita
ao Chat QA; sua documentação nesta PR, contudo, **não a implanta em
produção** nem altera permissões.

## 1. Responsabilidade vigente — fase humana provisória

1. **Administrador/Fundador:** é o **responsável principal e
   provisório** por toda a moderação do aplicativo. Dirige a política
   operacional, define quem poderá moderar, quais atribuições delega,
   revisa as medidas da equipe e decide sobre a futura transição.
2. **Moderadores:** somente pessoas **designadas pelo
   Administrador/Fundador** poderão atuar como moderadores. Sua
   atuação deve permanecer no escopo e nas permissões que ele
   estabelecer. Ser usuário, portar um selo visual ou aparecer numa
   discussão **não** concede o papel de moderador.
3. **Delegação/revogação:** é decisão do Administrador/Fundador
   atribuir, limitar, revisar ou retirar a função dos moderadores.
   Nenhuma designação individual, conta/UID, privilégio ou permissão
   de Firestore foi criada por este registro.
4. **Natureza provisória:** esta organização humana é a solução
   adotada **até a homologação e autorização do Átrio Guardião V2**
   para executar as atividades automatizáveis. Não há prazo fixado
   pelo fundador para a transição.

**Registro sem lacunas inventadas:** não foram fornecidos nomes,
contas/UIDs ou escala de moderadores. A responsabilidade principal
já está decidida; **não se deve apresentar “quem responde pela
moderação” como uma escolha ainda em aberto**. Permanecem por
designar, quando necessários, moderadores concretos, suplência,
disponibilidade e acesso administrativo mínimo.

## 2. Atividades humanas abrangidas pela decisão

A responsabilidade cobre, conforme os recursos efetivamente
disponibilizados, a gestão de denúncias, análise contextual de
infrações, prevenção de assédio, ameaças, spam e abuso, medidas
proporcionais, contestação/revisão de decisões, proteção de
evidências e encaminhamento de situações de risco.

Isso **não prova que todos esses fluxos já existam ou tenham
equipe/plantão permanente**. A execução depende dos mecanismos e
procedimentos habilitados, políticas adequadas e competências
necessárias. Não prometer monitoramento 24 horas sem operação real.

**Limite de acesso:** a função de moderador não autoriza leitura
irrestrita de mensagens privadas, exportação indiscriminada de
conversas, autoconcessão de privilégios, exclusão arbitrária de
evidências ou acesso a dados de terceiros sem fundamento.
Regras de acesso, auditoria e minimização devem ser respeitadas.
Qualquer função sensível exige implementação e testes específicos.

## 3. Destino planejado: automação com o Átrio Guardião V2

O Administrador/Fundador pretende **automatizar progressivamente
toda a moderação tecnicamente automatizável com o Átrio Guardião
V2**. Esse é o objetivo de evolução arquitetural, **não o estado
atual de produção nem uma autorização de ativação**.

A transição somente pode avançar após testes reais e sintéticos
apropriados, revisão de segurança, custos e privacidade, regras
de tratamento de falsos positivos, auditoria de decisões, recursos,
reversão de medidas e **autorização explícita do fundador**.
O V2 deve evitar ações punitivas automáticas por simples
divergências de opinião, discussões religiosas ou denúncias
não comprovadas. Nenhuma sanção automática adicional está
autorizada por esta decisão documental.

A automação **não elimina a responsabilidade de governança do
Administrador/Fundador**. Deve permanecer possibilidade de
intervenção humana para situações sensíveis, recursos,
erros, emergências e parada segura, ainda que a operação
rotineira venha a ser amplamente automatizada.

O **Guardião V1 é legado**, não uma alternativa para voltar a
moderar paralelamente ao V2. Evitar duplicação de decisões entre
V1 e V2 e preservar notificações e dados anteriores durante
eventual migração, conforme
`docs/guardiao-v2-convivencia-v1-v2.md`.

## 4. Etapas de transição — planejamento, não autorização

| Fase | Responsável operacional | Automação permitida por este documento | Estado |
| --- | --- | --- | --- |
| Humana provisória | Administrador/Fundador e moderadores por ele designados | Nenhuma nova função é ativada | **DECISÃO VIGENTE** |
| QA sintético e observação do V2 | Supervisão humana do fundador/designados | Testes isolados, conforme permissões já concedidas | Depende de homologação |
| Triagem assistida em ambiente autorizado | Fundador/designados supervisionam V2 | Apenas após aprovação específica, sem sanções não autorizadas | Pendente |
| Evolução para automação ampliada | Fundador mantém governança e via de revisão/interrupção | Ações graduais após políticas, segurança e autorização próprias | **PLANEJADA, NÃO ATIVA** |

**Critérios mínimos de passagem:** identidade e IAM restritos,
deduplicação, limites de custo, logs sanitizados, prevenção de
falsos positivos, revisão humana/recursos, emergência/rollback,
testes end-to-end e aprovação do escopo de QA e produção **em
momentos separados**. Não ativar V1 como substituto automático
em falha do V2.

## 5. Decisões relacionadas e pendências que permanecem

- **Autodeclaração 18+:** decisão funcional provisória já tomada
  pelo fundador, com data informada/cálculo local, até haver
  orçamento para alternativa robusta; sem dependência paga agora.
  Isso é distinto da moderação e não comprova idade.
- **Moderação principal:** responsável conhecido por função
  (**Administrador/Fundador**) — **DEFINIDO**.
- **Quem pode ser moderador:** apenas pessoas designadas pelo
  Administrador/Fundador — **CRITÉRIO DEFINIDO**.
- **Moderadores individualmente designados e substituição em
  ausências:** ainda não constam deste registro público; nenhuma
  nova conta foi nomeada — **PENDENTE QUANDO NECESSÁRIO**.
- **Canal real para denúncias tardias, triagem urgente, recursos,
  acesso a evidências e equipe/horário real:** procedimentos e
  homologação específicos — **PENDENTES**.
- **Política de retenção por classe, termos, privacidade, revisão
  jurídica e acesso provável por menores:** **PENDENTES**.
- **Átrio Guardião V2:** destino de automação **PLANEJADO**;
  integração operacional e sanções autônomas não são aprovadas
  pela presente decisão.
- **Publicação no Firebase QA real e produção:** dependem de
  autorizações distintas, revisão de Rules/IAM/rollback,
  sem extrapolar a documentação da PR #232.
- **Estado de marcos de QA:** ativação 60% (3/5), QA geral
  29% (2/7), **NO_GO**, sem alteração por este registro.

## 6. Referências e rastreabilidade

- Decisão expressa do Administrador/Fundador nesta conversa,
  em **11/11/2026**, solicitando documentação.
- `docs/guardiao-v2-convivencia-v1-v2.md`: V2 como destino
  da automação, V1 legado e necessidade de supervisão humana.
- `docs/qa-homologacao/MODERACAO-PRIVACIDADE-RETENCAO-DECISOES-QA.md`:
  limites de acesso, denúncias e pendências de atendimento.
- `docs/qa-homologacao/PACOTE-DECISOES-OPERACIONAIS-ISSUE-200-QA.md`:
  frentes de privacidade/retencão pendentes.
- Issues #200 e PR #232: registro operacional, revisão e histórico.

**Este documento registra uma DIRETRIZ DE GESTÃO.** Não modifica
`admins/{uid}`, selos, Rules, Guardião V2, workflows, credenciais,
IAM, Cloudflare, Firebase, permissões, dados de usuários,
assinatura de APK, `main`, produção ou backups. Nenhum merge
ou deploy é autorizado aqui.
