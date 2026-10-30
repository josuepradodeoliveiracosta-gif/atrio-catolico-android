# Átrio Guardião V2 — verificação das cotas e dos planos reais

**30/10/2026 — Estado NO-GO para lançamento.** A documentação oficial comprova que existem planos gratuitos, mas não comprova qual plano está ativo nas contas do Átrio.

## Informações verificadas

- O repositório do Átrio foi consultado pelo GitHub: é público. Os workflows usam ubuntu-latest, runner padrão gratuito em repositórios públicos.
- Cloudflare Workers Account Settings respondeu HTTP 200 com default_usage_model = standard. **Isso não prova um plano de assinatura pago nem gratuito.** A consulta à API de assinaturas não tinha permissão (HTTP 403). Logo, o plano Workers Free da conta continua não verificado.
- O plano Firebase Spark/Blaze da conta não foi confirmado por nenhuma ferramenta autorizada.
- Os limites documentados para Firestore Standard Spark são 50.000 leituras, 20.000 gravações e 20.000 exclusões por dia; 1 GiB armazenado e 10 GiB/mês de transferência de saída.
- Workers Free admite 100.000 requisições por dia; D1 Free 5 milhões de linhas lidas e 100.000 gravadas por dia, até 5 GB armazenados. Não confundir linhas D1 com consultas SQL.
- As cotas são compartilhadas com todo o projeto e a conta, inclusive outros recursos do Átrio, e não reservadas para o Guardião.

## Avaliação local (não coleta informações automaticamente)

O script scripts/guardian-free-capacity.py usa **somente um JSON preenchido manualmente**. Não faz chamadas a serviços, não contém tokens e não interfere nos planos das contas. Para usar no Termux:

1. Gere um modelo: python3 scripts/guardian-free-capacity.py --template > /sdcard/Download/guardiao-capacidade.json
2. Confirme nos painéis oficiais os planos, o faturamento e os contadores atuais. Preencha todos os campos com métricas da **conta inteira**, incluindo o instante em UTC.
3. Execute: python3 scripts/guardian-free-capacity.py --check /sdcard/Download/guardiao-capacidade.json

Se houver plano desconhecido, billing ativo, contador ausente, medição com mais de 12 horas ou **mais de 75% de qualquer limite gratuito**, o script emite GUARDIAN_FREE_BUDGET_NO_GO.

A margem de 25% é uma reserva **prudencial do projeto**, não um bloqueio técnico do tráfego real, nem uma garantia de que a conta nunca será cobrada. Mesmo uma avaliação positiva apenas indica métricas momentaneamente abaixo da margem; **não autoriza produção, configuração de IAM, HOLD ou automação**.

**Não inclua credenciais, dados pessoais, cartões, tokens ou documentos de faturamento neste JSON. Não envie uma medição privada para o repositório público.**

## Critérios ainda pendentes

1. Confirmar contas em Firebase Spark e Cloudflare Workers Free, sem vínculo de faturamento ou contratação.
2. Conferir cotas de uso e saturação total, com controle de quedas de serviço sem upgrades.
3. Revisar e autorizar separadamente qualquer publicação supervisionada.
4. Para 24/7 autônomo, comprovar identidade de servidor segura, keyless e sem cobrança potencial; caso contrário, NO-GO.

Fontes oficiais verificadas em 30/10/2026:
- https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- https://firebase.google.com/docs/firestore/quotas
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/
- https://docs.github.com/en/actions/concepts/billing-and-usage

Nenhum serviço pago, mudança de produção ou backup é necessário para esta auditoria.
