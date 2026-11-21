# MINUTA — Política etária 18+ do Átrio Católico

> **RASCUNHO PARA REVISÃO — NÃO APROVADO, NÃO VIGENTE E NÃO PRONTO PARA PUBLICAÇÃO.**
>
> Este documento organiza a decisão de produto e a proposta de verificação etária. Não é aconselhamento jurídico nem prova de conformidade com a LGPD, o ECA ou as políticas da Google Play. A publicação depende de revisão de privacidade/jurídica e aprovação expressa do responsável pelo Átrio.

**Versão de trabalho:** 0.1  
**Data de vigência:** não definida; somente após aprovação, implementação e publicação.  
**Controlador e canal de privacidade:** pendentes de confirmação na minuta geral de privacidade.

## 1. Decisão de produto

- **Idade mínima pretendida:** 18 anos para criar e usar uma conta em qualquer área do Átrio Católico.
- A regra inclui perfil, publicações, conversas privadas, grupos, notificações e demais recursos; não se limita a Conversas.
- O serviço está em teste fechado, conforme declaração do responsável registrada na issue #200. Essa declaração não é comprovação individual de idade.
- A política permanece uma proposta interna até a revisão jurídica, a aprovação do responsável e a implementação dos controles correspondentes.

## 2. Verificação proposta para o teste fechado

Para a fase fechada, propõe-se pedir:

1. a data de nascimento, informada pela própria pessoa;
2. uma confirmação destacada de que ela tem 18 anos ou mais.

O cálculo da idade deve ocorrer no dispositivo. A data de nascimento não deve ser enviada nem persistida pelo Átrio. Se a data for inválida, indicar idade inferior a 18 anos ou a pessoa não confirmar a maioridade, o cadastro e o acesso devem ser bloqueados sem criar uma conta comunitária.

**Limite de garantia:** data informada e autodeclaração são uma barreira de entrada, não uma prova independente de idade. Elas podem ser falsificadas. O método foi registrado como provisório para o grupo fechado de testes; não deve ser descrito como verificação documental ou validação independente.

## 3. Dados mínimos e controles técnicos propostos

Após aprovação e implementação, o backend — não o aplicativo cliente — deve estabelecer a elegibilidade. Se for necessário guardar evidência, limitar o registro a:

- resultado de elegibilidade (`eligible` ou estado equivalente);
- idade mínima aplicada e versão da política;
- data de verificação e, se juridicamente justificado, validade/revisão.

O registro deve permanecer privado, com acesso mínimo e sem permissão de escrita pelo cliente. A finalidade e o prazo de retenção dessa evidência ainda precisam de aprovação jurídica. Não guardar data de nascimento, cópia de documento, selfie, biometria ou resposta detalhada do cálculo sem uma nova avaliação de necessidade, proporcionalidade, segurança e base legal.

Uma resposta negativa ou falha de verificação deve negar acesso por padrão. O fluxo final precisa prever correção de erro e contestação por canal privado, sem solicitar documentos em conversas públicas ou logs de suporte comuns.

## 4. Menor identificado ou suspeita de idade incorreta

Se houver indicação confiável de que uma pessoa tem menos de 18 anos:

- suspender o acesso às áreas do Átrio conforme procedimento aprovado;
- não solicitar que a pessoa publique documentos ou dados de nascimento;
- encaminhar o caso ao responsável autorizado por canal privado;
- eliminar a data de nascimento informada, se tiver sido temporariamente processada ou registrada;
- manter apenas o registro mínimo cuja retenção seja justificada e aprovada, com prazo definido.

Responsáveis, prazos, revisão humana, recurso e eventual comunicação legal ainda não foram definidos. Esta minuta não autoriza coleta adicional nem tratamento novo.

## 5. Antes de inscrições abertas ou lançamento público

Antes de ampliar o público, o responsável deve reavaliar se a autodeclaração é adequada ao risco e às obrigações aplicáveis. Uma verificação externa só deve ser adotada após análise de privacidade/jurídica, segurança, contrato, transferências internacionais, retenção e alternativas menos invasivas.

Se um fornecedor vier a ser escolhido, priorizar uma resposta de limiar etário — “18+” — sem que o Átrio receba ou retenha documento, imagem facial ou data de nascimento. A escolha de fornecedor, custo e compartilhamento não estão aprovados por esta minuta.

## 6. Implementação e limites atuais

- O código Android agora coleta a data apenas na tela de entrada, calcula a idade localmente e exige a confirmação 18+. A data não é gravada em preferências, Firestore ou logs.
- Após autenticação, `recordAgeEligibility` grava somente o resultado, a idade mínima, a versão, o método e o horário da autodeclaração em documento privado.
- As regras de `firestore.rules` exigem a elegibilidade quando `app_config/age_policy.enabled` for ativado por administração. O controle fica desligado por padrão no repositório para permitir migração coordenada de APK, função e regras.
- Como o método é autodeclaração, uma pessoa pode falsificar a data ou chamar a função sem usar a tela. **O fluxo não comprova idade de forma independente.**
- `firebase/qa-general/age18-gate.mjs` continua sendo somente uma fixture de QA offline; ela não comprova idade real nem substitui a função ou as regras da política geral.
- As prévias de Termos e Privacidade continuam sem ser documentos finais ou aceite versionado.

O código está implementado na fonte, mas não houve implantação da função, das regras ou da configuração de ativação. Isso não aprova o texto, não libera produção e não comprova que a política esteja ativa no Firebase.

## 7. Itens para revisão de privacidade/jurídica e aprovação

- [ ] Revisar juridicamente a redação e o alcance 18+ em todas as áreas do Átrio.
- [ ] Validar o público-alvo e os requisitos aplicáveis ao serviço e à distribuição no Brasil.
- [ ] Avaliar a base legal, a necessidade e a transparência do processamento da data de nascimento, mesmo quando o cálculo é local.
- [ ] Aprovar o tratamento de resultados de elegibilidade, acesso, retenção e exclusão.
- [ ] Definir mensagem para pessoas abaixo de 18 anos, correção de erro, recurso e atendimento privado.
- [ ] Revisar riscos de falsidade da autodeclaração e condições para reavaliar o método antes do acesso público.
- [ ] Confirmar que controles de cliente, backend, Firestore Rules, logs e analytics não recebem nem retêm a data de nascimento.
- [ ] Validar consistência com Termos de Uso, Política de Privacidade, Google Play Data Safety e fluxo de aceite versionado.
- [ ] Registrar nome/função do revisor, versão revisada, comentários e decisão; não preencher esses campos sem confirmação.
- [ ] Obter aprovação expressa do responsável pelo Átrio e definir a data de vigência após a implementação e publicação.

## Referências do projeto

- [Minuta da Política de Privacidade](MINUTA-POLITICA-PRIVACIDADE-2026-11-09.md), seção 8.
- [Minuta dos Termos de Uso](MINUTA-TERMOS-USO-2026-11-09.md), seção 2.
- [Plano de adequação de Termos e Privacidade](PLANO-ADEQUACAO-TERMOS-PRIVACIDADE-2026-11-09.md), matriz P0.
- `app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt`: prévias de Termos e Privacidade no cadastro.
- `firebase/qa-general/age18-gate.mjs`: gate de idade exclusivo de QA offline.
- Issue #200: decisão provisória relatada pelo responsável para o teste fechado e pendência de aprovação jurídica.
