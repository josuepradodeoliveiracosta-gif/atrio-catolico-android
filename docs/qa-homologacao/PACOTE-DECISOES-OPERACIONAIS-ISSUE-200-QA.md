# Átrio Católico — pacote decisório de moderação e privacidade (issue #200)

**Minuta operacional para revisão | QA fechado | 11/11/2026 | NÃO APROVADA | NO_GO**

Este material organiza decisões para o fundador e revisores. Não implementa
canal de suporte, não publica políticas, não define prazos legais, não aprova
monitoramento contínuo nem autoriza qualquer escrita no Firebase, Cloudflare,
produção ou backups. Não colocar nomes, UIDs, denúncias, conversas ou e-mails
pessoais neste repositório público; registrar evidência privada por canal adequado.

## 1. O que não será rediscutido

**DECIDIDO PELO FUNDADOR:** idade mínima de 18 anos para mensagens privadas
e grupos. Método operacional provisório: data de nascimento informada
localmente, cálculo de idade e autodeclaração expressa 18+, sem serviço pago,
até haver orçamento para verificação mais robusta. Não confundir isso com
comprovação de idade nem com aprovação de conformidade jurídica.

A análise jurídica dos riscos de acesso provável por menores continua
pendente, sem alterar a decisão funcional. Regras de e-mail, consentimento,
bloqueios, grupos, denúncias e retenção são controles separados.

## Diretriz do fundador — moderação humana provisória e Guardião V2

**Decisão DEFINIDA em 11/11/2026 para todo o aplicativo:** o
**Administrador/Fundador é o responsável principal provisório
pela moderação**, podendo designar moderadores e estabelecer seu
escopo. Apenas moderadores escolhidos por ele atuarão como
moderadores. Isso **não** indica que contas específicas já tenham
recebido privilégios ou que haja substituto nomeado.

A estrutura humana permanece até o **Átrio Guardião V2** estar
adequadamente testado, homologado e autorizado para automatizar
gradualmente as tarefas. O objetivo de automatização ampla não
remove a autoridade e supervisão do fundador, o direito a recurso,
a necessidade de intervenção em casos sensíveis ou a possibilidade
de interromper a automação.

[Decisão completa e limites](DIRETRIZ-MODERACAO-HUMANA-TRANSICAO-GUARDIAO-V2.md).

**Não tratar a definição da responsabilidade principal como uma
pendência aberta.** Ainda faltam: nomeação individual e cobertura
dos moderadores, canal real, procedimentos, prazos de resposta e
retenção, revisão legal e autorizações de deploy. A issue #200
segue aberta e o estado QA permanece NO_GO.

## 2. Fluxo mínimo de denúncia proposto (ainda não operacional)

1. **Entrada dentro de conversa/grupo:** utilizar protocolos existentes
   chat_reports e chat_group_reports enquanto a Rules permitir. São cópias
   da mensagem apontada, não autorização geral de leitura de históricos.
2. **Entrada tardia/sem acesso:** uma pessoa que saiu de grupo, foi
   suspensa ou está com o chat desativado precisa de canal externo
   autenticado quando possível e com minimização de dados. **O canal
   não existe hoje e deve ser escolhido e aprovado antes de sua oferta.**
3. **Acolhimento:** informar que o recebimento não comprova os fatos.
   Coletar apenas relato mínimo e canal de retorno adequado, sem pedir
   CPF, foto, dados religiosos nem exportação automática de mensagens.
4. **Triagem humana:** identificar perigo imediato, potencial dano a
   menores, assédio/ameaça, fraude, spam e outras violações. Não tratar
   uma palavra-chave ou denúncia isolada como sanção automática.
5. **Controle de acesso:** conferir cargo ativo e necessidade, registrar
   acessos administrativos minimizados, nunca disponibilizar leitura
   irrestrita de DMs e grupos.
6. **Preservação:** manter protocolo de evidência suficiente apenas
   conforme finalidade, base legal e prazo a serem aprovados; jamais
   remover registros para impedir apuração ou acessar históricos por
   conveniência.
7. **Decisão e recurso:** decisão humana fundamentada, medida
   proporcional, aviso seguro e canal de contestação por revisor
   distinto quando houver condição operacional.
8. **Encerramento:** fechar atendimento não significa eliminar dados.
   Respeitar solicitações do titular e preservações legais aprovadas.

### Casos que precisam de simulação antes de ativar

- Autor da denúncia perde o acesso ao grupo, mas conserva somente
  seu protocolo preexistente.
- Moderador desativado deixa imediatamente de consultar denúncias.
- Denunciante tenta consultar relatos de outros usuários: negado.
- Usuário sem acesso envia pedido tardio: o canal proposto não deve
  revelar existência de grupo, mensagem ou participante privado.
- Tentativa de denúncia fabricada, repetida ou com identificador
  alheio não pode ampliar acesso; a triagem não declara culpado.
- Indisponibilidade do canal, conflito de interesse, urgência e
  ausência de equipe real precisam de caminho de contingência.

## 3. Deliberações preparadas para aprovação individual

| Frente | Escolha recomendada para discussão | Responsável e evidência pendentes |
| --- | --- | --- |
| Proteção de menores | Manter autodeclaração 18+ já escolhida, avaliar acesso provável e obrigações do serviço | Revisor jurídico/privacidade e parecer específico |
| Operação humana | **Fundador responsável principal provisório (DEFINIDO)**; moderadores somente se designados por ele e com acesso mínimo | Nomeações individuais, suplência/disponibilidade e acessos ainda pendentes |
| Canal tardio | Canal separado de relatos, com retorno autenticado quando possível, sem acesso automático a históricos | Ferramenta, acesso, custos e política de suporte |
| Urgência | Protocolo de triagem/escalonamento realista, proteção e encaminhamento conforme risco | Plantão real, critérios e contatos institucionais |
| Evidências | Exibir apenas trecho denunciado e fundamento de preservação, com auditoria sanitizada | Acesso, fundamento e procedimento de controle |
| Recurso e direitos | Recebimento de contestação, acesso e exclusão sob análise humana | Canal, identidade do solicitante e revisão independente |
| Retenção | Avaliar individualmente as 13 classes já inventariadas; jamais presumir prazo ou apagar por cronômetro | Prazo, base, exceções legais, backups e subcoleções |
| Política final | Termos, política de privacidade, controlador e contatos verificados | Revisão adequada, versão, data e autorização específica |

**Prazos de resposta:** não inventados. Precisam corresponder à equipe
disponível e aos prazos legais efetivamente aplicáveis. Não prometer
atendimento 24 horas sem equipe capaz de cumpri-lo.

## 4. Ficha de aprovação para preencher FORA do repositório público

- Qual das oito frentes e qual versão de política?
- Quem aprovou, quando, em qual competência e por qual canal seguro?
- Qual a base legal e o risco residual aceito?
- Quem executará? Há substituto e restrição de acesso?
- Qual é o procedimento de contingência para denúncia urgente?
- Qual prazo de resposta e retenção será realmente viável? Quais exceções?
- Quais testes e evidências demonstram o comportamento, sem dados reais?
- Esta autorização cobre **apenas revisão**, **QA real**, ou **produção**?
  Essas três situações exigem decisões distintas.

**Não preencher aprovações na tabela de status automaticamente.**
O arquivo ISSUE-200-GOVERNANCA-QA.json contém somente estado público
de acompanhamento, sem PII. A marca REVIEW_RECORDED significa apenas
que alguém registrou uma revisão; NÃO comprova a aprovação.
O script scripts/chat-qa-governance-preflight.mjs é estritamente
offline e retorna ready_for_qa_deploy=false até haver mecanismo
independente de aprovação/alteração controlada.

## 5. Enquadramento jurídico ainda em aberto

ANPD — Guia de escopo e obrigações do ECA Digital, 28/10/2026:
https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-que-esclarece-quem-deve-cumprir-e-quais-sao-as-responsabilidades-das-plataformas-na-protecao-de-criancas-e-adolescentes

ANPD — Dados pessoais sensíveis e direitos do titular:
https://www.gov.br/anpd/pt-br/canais_atendimento/cidadao-titular-de-dados/denuncia-peticao-de-titular-referente-lgpd

O enquadramento do serviço depende das funcionalidades e riscos
concretos, não apenas de declarar público adulto. Preferências
religiosas são dados potencialmente sensíveis. O conteúdo deste
documento não substitui revisão jurídica nem comprovação de
cumprimento da LGPD/ECA Digital.

## 6. Critérios de bloqueio / passo seguinte

Embora a responsabilidade principal já esteja definida pelo fundador, enquanto faltar designação operacional necessária, canal, política validada,
análise dos riscos e autorização para uso de dados reais, a issue #200
permanece aberta. O QA real não será alterado por esta minuta.
Verificar novamente IAM, Ruleset, quatro app_config e plano de
reversão imediatamente antes de qualquer publicação autorizada.
Sempre manter PR #232 em rascunho sem merge em main e sem tocar
em produção ou backups. Ativação QA: 60% (3/5); QA geral: 29% (2/7).
