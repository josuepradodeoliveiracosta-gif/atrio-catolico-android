# Átrio Guardião V2 — política obrigatória de custo zero

**Decisão do responsável pelo projeto (30/10/2026): operação exclusivamente gratuita, sem assinatura, contratação de serviço pago ou qualquer cobrança.**

Esta política é requisito bloqueante para desenho, testes, implantação, manutenção e atualizações do Átrio Católico e do Átrio Guardião. Prevalece sobre sugestões anteriores de usar produtos com "free tier" que exigem conta de faturamento.

## Regras inegociáveis

1. **R$ 0 de gasto obrigatório e de cobrança possível:** não contratar assinatura, plano pago, pay-as-you-go, upgrades, período de teste que converta em plano pago, créditos promocionais como condição de funcionamento, nem APIs cobradas por uso.
2. **Nenhum vínculo novo de faturamento:** não ativar Google Cloud Billing, Blaze, Workers Paid ou outro serviço que exija cadastrar cartão, habilitar faturamento ou aceitar cobranças futuras — mesmo se parte do uso estiver no nível gratuito.
3. **Antes de cada serviço ou recurso novo:** documentar fonte oficial e atual das regras de preço, requisitos de billing, quotas, comportamento ao atingir limite e situação do plano da conta. **Não presumir** qual plano está ativo. Se faltar prova de custo zero sem cobrança potencial, **NO-GO**.
4. **Cota atingida ou indisponibilidade:** falhar de modo seguro, interromper a função opcional, tentar novamente apenas após restabelecimento de cota gratuita, e informar o operador. Nunca fazer upgrade automaticamente ou recorrer a API paga. Não prometer disponibilidade 24/7 se a cota gratuita não comportar.
5. **Infraestrutura oficial preservada:** nenhuma mudança em faturamento, planos, IAM de produção, Firebase oficial, backups, `main`, assinatura de APK Release ou Workers Push/Avatar como consequência desta política sem aprovação específica. Nenhuma mudança de cobrança será solicitada como solução para falhas técnicas.
6. **Desenvolvimento e CI:** executar apenas no uso já permitido sem custo dos recursos conectados; se as cotas de CI forem insuficientes, preferir ensaios locais pelo Termux/emuladores ou reduzir o escopo em vez de comprar minutos.
7. **Moderação:** o Guardião não poderá usar IA paga, Cloud Functions que exijam Blaze, Cloud Run ou outro backend que exija ativar billing. Se a automação segura e contínua não for viável no escopo gratuito, manter a moderação automática indisponível e usar etapas locais/preventivas/revisão humana até existir alternativa comprovada.

## Serviços admitidos somente após verificação da conta

- **Firebase Spark:** funcionalidades explicitamente disponíveis nesse plano, com respeito às cotas de Firestore e Authentication; não converter para Blaze. Nem todas as opções de autenticação/armazenamento e recursos Firebase fazem parte do Spark.
- **Cloudflare Workers Free e D1 Free:** apenas funcionalidades suportadas no plano gratuito; ao alcançar limites, a operação deve negar com segurança, sem upgrade. A quota grátis não implica capacidade ilimitada.
- **Ferramentas locais e código aberto** (Termux, testes offline, emuladores) e ferramentas de CI gratuitas dentro das quotas reais do repositório.

O uso de um produto não está autorizado pelo simples fato de constar nesta lista; é preciso confirmar o plano real da conta e o custo das operações específicas.

## Recursos descartados para este projeto

- **Google Cloud Run / Cloud Scheduler, Cloud Build etc. que dependam de Google Cloud Billing.** O Google exige conta de faturamento ativa para recursos Google Cloud, mesmo quando o uso pode ficar dentro de nível gratuito. O Cloud Run não será apresentado como próxima solução viável de identidade do Guardião.
- **Firebase Blaze e Cloud Functions que necessitem Blaze**, serviços com cobranças excedentes ou cartão; **Cloudflare Workers Paid** e IA comercial cobrada por requisição.
- Soluções que dependam de trial, créditos promocionais ou de um cartão mesmo se disserem "gratuito".

## Questão técnica em aberto

A execução autônoma de moderação 24/7 e escrita administrativa no Firestore exige um mecanismo de identidade de servidor confiável e autorização estrita. O Worker Cloudflare não ganha essa identidade pela federação de CI GitHub. **Não há ainda arquitetura aprovada que prove moderação contínua, segura e custo zero** nesse conjunto de restrições.

Até uma alternativa comprovada, manter `GUARDIAN_V2_ENABLED=false`, `GUARDIAN_V2_HOLD_ENABLED=false`, ponte QA fechada por padrão, sem segredos permanentes. Continuar com aviso preventivo local, classificação sintética, testes e revisão humana compatíveis com o plano gratuito.

## Fontes oficiais consultadas em 30/10/2026

- Firebase Spark e Blaze: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- Quotas gratuitas do Firestore: https://firebase.google.com/docs/firestore/pricing
- Google Cloud Billing (exigido para serviços Google Cloud): https://docs.cloud.google.com/billing/docs/how-to/manage-billing-account
- Cloudflare Workers Free: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare D1 Free e comportamento ao atingir cota: https://developers.cloudflare.com/d1/platform/pricing/

**Critério de aprovação financeira: custo exigido = R$ 0; possibilidade de cobrança ou vínculo de faturamento = inexistente; caso contrário, NO-GO.**
