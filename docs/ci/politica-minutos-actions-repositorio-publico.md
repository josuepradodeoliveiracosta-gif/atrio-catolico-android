# GitHub Actions — minutos e limites no repositório público

**Verificado em:** 11/11/2026.  
**Repositório:** `josuepradodeoliveiracosta-gif/atrio-catolico-android` (visibilidade **pública** na verificação).  
**Escopo:** orientação de documentação e decisões de CI; não altera workflows, jobs, faturamento ou permissões.

## Regra aplicável

O GitHub documenta que a execução de jobs com **runners padrão hospedados pelo GitHub** em **repositórios públicos** é **gratuita e sem franquia mensal de minutos**. Portanto, os minutos desses jobs não precisam ser economizados para caber na franquia de minutos incluídos para repositórios privados. O `ubuntu-latest` utilizado nos workflows do Átrio é um exemplo de runner padrão.

Isso **não significa que o GitHub Actions seja livre de qualquer limite**:

- **Concorrência e filas:** os limites de jobs simultâneos dependem do plano da conta e do tipo de runner; mesmo sem franquia mensal, muitos jobs podem gerar esperas.
- **Duração:** um job em runner hospedado pelo GitHub tem limite de execução de até 6 horas; os `timeout-minutes` menores definidos nos workflows continuam válidos e úteis.
- **Execuções e recursos:** existem limites para workflows, taxa de disparos, matrizes, caches e armazenamento de artefatos.
- **Modalidades diferentes:** runners maiores/avançados podem ser cobrados mesmo em repositório público. Se o repositório for tornado **privado**, a política de minutos e cobrança muda. A regra gratuita não deve ser generalizada para outros serviços e infraestrutura do projeto.

## Critérios de otimização do Átrio Católico

1. **Prioridade:** segurança, correção, checks obrigatórios (inclusive Firestore e CodeQL completo), estabilidade, tempo de entrega e paralelismo adequado.
2. **Não retirar testes nem enfraquecer controles** apenas para economizar minutos de runners padrão gratuitos.
3. **Evitar duplicação e execuções desnecessárias** quando comprovadamente melhorarem latência, filas, qualidade de manutenção ou confiabilidade; o uso gratuito não elimina limites de concorrência.
4. **Preservar os timeouts de segurança** e a seletividade dos jobs por escopo; mudanças exigem medição e validação por PR.
5. **Rever a documentação** caso o repositório deixe de ser público, sejam adotados runners maiores/avançados ou o GitHub altere sua política.

## Documentação oficial do GitHub

- [Cobrança e uso do GitHub Actions](https://docs.github.com/pt/actions/concepts/billing-and-usage): uso gratuito de runners padrão em repositórios públicos.
- [Escolhendo o runner para um job](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job): runners padrão gratuitos e sem limite de minutos em repositórios públicos.
- [Limites do GitHub Actions](https://docs.github.com/pt/actions/reference/limits): concorrência, duração, execuções e armazenamento.
- [Preços de runners](https://docs.github.com/en/billing/reference/actions-runner-pricing): runners maiores podem ser cobrados.

**Decisão registrada:** para o repositório público atual, otimizar o CI pela **velocidade e segurança**, e não pela economia de uma franquia mensal de minutos que não se aplica aos runners padrão.
