# Átrio Loja — contratos de integração com dropshipping

A primeira implementação usa um fornecedor simulado no QA Geral. A vitrine e a tela de produto da #434 continuam sendo a entrada do fluxo. O backend da Loja é responsável por cotação, checkout e pedidos. O adaptador é a fronteira com o futuro fornecedor.

## Catálogo

A vitrine lê uma lista de produtos publicados. Cada produto tem `id` estável da Loja, `categoryId`, `name`, `description` e uma lista de variantes. Cada variante tem `id`, `sku`, `label`, `unitPriceMinor`, `currency` e `availability` (`in_stock`, `out_of_stock` ou `unknown`). Os valores monetários são inteiros em centavos de BRL. A relação entre variante e código externo fica no adaptador.

Carregamento, ausência de produtos e indisponibilidade da consulta são estados distintos. Estoque desconhecido não é tratado como disponível. Preço e disponibilidade no catálogo são informativos até a cotação.

## Cotação e checkout

- `quote(items, destination)` recebe IDs de variantes, quantidades positivas e CEP. O backend consulta preço, disponibilidade, frete e prazo. Retorna `quoteId`, itens, subtotal, frete, total, moeda, prazo estimado e `expiresAt` em UTC. Quantidades do mesmo SKU são consolidadas antes da consulta.
- `createCheckout(quoteId, idempotencyKey)` confere a titularidade e a validade da cotação e revalida as condições antes de criar a sessão. Se preço, disponibilidade, frete ou prazo mudarem, pede nova confirmação com uma cotação atualizada. Retorna `orderId` e a URL HTTPS do checkout. O cliente aceita a origem configurada para a variante e volta à tela do pedido depois do checkout.
- O retorno pelo navegador serve apenas à navegação. O backend muda o estado de pagamento com base em evento autenticado do provedor, associado ao pedido e conferido pelo valor e pela moeda.

A mesma chave na mesma operação e para o mesmo comprador recupera o resultado anterior se os dados coincidirem. Reutilizar a chave com dados diferentes retorna conflito.

## Pedido, envio e pós-venda

O pedido registra os itens e preços aceitos, cotação, frete, total, moeda e referências da operação. Pagamento e expedição têm estados próprios. Pagamento começa em `pending` e pode ir para `paid` ou `failed`; estorno confirmado muda `paid` para `refunded`. A expedição começa em `not_submitted`, passa para `submitted`, `shipped` e `delivered`; um cancelamento confirmado antes do despacho leva a `cancelled`. Devolução após despacho é uma solicitação de pós-venda com estado próprio.

Depois da confirmação do pagamento, o backend reserva o envio ao fornecedor de forma persistente e atômica por `orderId`. A mesma referência acompanha todas as tentativas. O adaptador deve poder consultar a referência externa antes de repetir uma tentativa com resultado incerto. Eventos repetidos ou fora de ordem não duplicam o envio nem fazem o estado regredir. O app mostra rastreio quando fornecido e permite consultar apenas os pedidos do comprador autenticado.

Credenciais do fornecedor e do checkout ficam no backend. Ao fornecedor seguem apenas os dados necessários para expedição; o catálogo público e os relatórios de QA não carregam dados do comprador.

## Cenários de aceite dos próximos marcos

| Marco | Evidência esperada |
|---|---|
| 2. Catálogo | Variante disponível, sem estoque e com estoque desconhecido; mudança de preço; fonte indisponível; catálogo vazio. |
| 3. Checkout | Total confirmado em centavos, frete e prazo visíveis, recotação em caso de divergência, URL de QA e retorno ao mesmo pedido. |
| 4. Pedidos | Pagamento recusado não inicia envio; eventos duplicados geram uma expedição; rastreio, cancelamento, estorno e devolução exercitados. |
| 5. QA | Percurso completo com dados fictícios, registros sem dados pessoais e pontos de configuração do futuro fornecedor identificados. |
